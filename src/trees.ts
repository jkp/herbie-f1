// Trees: the Blender-built models (scripts/blender/make_trees.py → src/assets/trees.glb) planted as instances in
// tiles. Each tile draws a detailed model near the camera and a cheap one further out, crossfading between them with
// a dither; the crowns sway in the wind.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import treesUrl from './assets/trees.glb?url';

export const SPECIES = ['spruce', 'broadleaf', 'pine', 'palm'] as const;
export type Species = typeof SPECIES[number];
export type Mix = Partial<Record<Species, number>>;

/** What grows around each circuit (by track name), as fractions of the trees. */
const MIXES: Record<string, Mix> = {
  'Spa-Francorchamps': { spruce: 0.7, broadleaf: 0.3 }, // Ardennes spruce plantations and beech
  'Red Bull Ring': { spruce: 0.75, broadleaf: 0.15, pine: 0.1 },
  Silverstone: { broadleaf: 0.8, spruce: 0.1, pine: 0.1 },
  Monza: { broadleaf: 0.85, pine: 0.15 }, // the royal park's oaks and limes
  Hungaroring: { broadleaf: 0.7, pine: 0.3 },
  Zandvoort: { pine: 0.65, broadleaf: 0.35 }, // dune pines
  Interlagos: { broadleaf: 0.8, palm: 0.2 },
  Monaco: { pine: 0.45, palm: 0.4, broadleaf: 0.15 },
  Barcelona: { pine: 0.7, broadleaf: 0.2, palm: 0.1 },
  Bahrain: { palm: 1 },
  'Yas Marina': { palm: 1 },
};
export const speciesMix = (track: string): Mix => MIXES[track] ?? { broadleaf: 0.6, spruce: 0.4 };

/** A tree to plant: ground position, size and a random number for its species, turn and tint. */
export interface Plant { x: number; y: number; z: number; s: number }

const coarse = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
const quality = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('quality') : null;
// detailed trees within NEAR metres of the camera (fading over FADE), cheap ones out to FAR (just past the fog)
const NEAR = (quality ?? (coarse ? 'low' : 'high')) === 'low' ? 90 : 170, FADE = 25, FAR = 2400, TILE = 250;

let models: Record<string, THREE.BufferGeometry> | null = null, materials: { hi: THREE.Material; lo: THREE.Material } | null = null;
let loading: Promise<void> | null = null;
const waiting = new Set<THREE.Group>(); // forests built before the models arrived, upgraded once they do
const time = { value: 0 };

function treeMaterial(map: THREE.Texture, near: boolean) {
  const m = new THREE.MeshLambertMaterial({ map, vertexColors: true, alphaTest: 0.5, side: THREE.DoubleSide });
  m.onBeforeCompile = s => {
    s.uniforms.uTime = time;
    s.vertexShader = s.vertexShader.replace('#include <common>', `#include <common>
uniform float uTime;
varying float vFade;`).replace('#include <begin_vertex>', `#include <begin_vertex>
vec3 root = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
float f = clamp((distance(root.xz, cameraPosition.xz) - ${NEAR.toFixed(1)}) / ${FADE.toFixed(1)} + 0.5, 0.0, 1.0);
vFade = ${near ? 'f' : '1.0 - f'};
if (vFade > 0.999) transformed = vec3(0.0); // the other LOD draws this tree: collapse to nothing
// wind: the whole crown sways, more the higher up; leaves and twigs flutter
float h = max(transformed.y, 0.0) / 14.0, ph = root.x * 0.05 + root.z * 0.07;
transformed.xz += vec2(sin(uTime * 1.1 + ph), cos(uTime * 0.9 + ph * 1.3)) * 0.18 * h * h
  + 0.05 * h * sin(uTime * 4.0 + dot(transformed, vec3(2.1, 1.3, 1.7)));`);
    // dithered crossfade between the LODs; normals stay bent outward on both faces of a card
    s.fragmentShader = s.fragmentShader.replace('#include <common>', `#include <common>
varying float vFade;`).replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
if (fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) < vFade) discard;`)
      .replace('#include <normal_fragment_begin>', THREE.ShaderChunk.normal_fragment_begin.replace('normal *= faceDirection;', ''));
  };
  m.customProgramCacheKey = () => `tree-${near}`;
  return m;
}

/** Fetch the tree models (once, in the browser); forests already built switch over when they arrive. */
export function loadTreeModels() {
  loading ??= new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(treesUrl).then(gltf => {
    const geos: Record<string, THREE.BufferGeometry> = {};
    let map: THREE.Texture | null = null;
    gltf.scene.traverse(o => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.updateWorldMatrix(true, false);
      // the file is quantized (normalized integers, scaled back by the node): bake that into plain floats
      const geo = new THREE.BufferGeometry().setIndex(mesh.geometry.index);
      for (const [name, attr] of Object.entries(mesh.geometry.attributes)) {
        const a = new Float32Array(attr.count * attr.itemSize);
        for (let i = 0; i < attr.count; i++) for (let c = 0; c < attr.itemSize; c++) a[i * attr.itemSize + c] = attr.getComponent(i, c);
        geo.setAttribute(name, new THREE.BufferAttribute(a, attr.itemSize));
      }
      geos[mesh.name] = geo.applyMatrix4(mesh.matrixWorld);
      map ??= (mesh.material as THREE.MeshStandardMaterial).map;
    });
    map!.anisotropy = 4;
    models = geos; materials = { hi: treeMaterial(map!, true), lo: treeMaterial(map!, false) };
    for (const g of waiting) dress(g);
    waiting.clear();
  });
  return loading;
}
export const treeModelsLoaded = () => !!models;

// before the models load (and in tests): a plain cone per tree
const stand = new THREE.ConeGeometry(3, 14, 7); stand.translate(0, 7, 0);
const standMat = new THREE.MeshLambertMaterial({ color: 0x2c5a2c });

function dress(g: THREE.Group) {
  for (const mesh of g.children as THREE.InstancedMesh[]) {
    if (!mesh.userData.lod) continue;
    mesh.geometry = models![`${mesh.userData.species}_${mesh.userData.lod}`];
    mesh.material = materials![mesh.userData.lod as 'hi' | 'lo'];
    mesh.boundingSphere = null; mesh.computeBoundingSphere();
    mesh.castShadow = mesh.userData.lod === 'hi';
  }
  g.userData.ready = true;
}

/** Instanced trees, species drawn from `mix` in stands (not salt-and-pepper), in tiles that cull and switch LOD. */
export function plantTrees(plants: Plant[], mix: Mix, rnd: () => number) {
  const kinds = SPECIES.filter(s => mix[s]), cum: number[] = [];
  kinds.reduce((a, s) => { cum.push(a + mix[s]!); return a + mix[s]!; }, 0);
  const stand_ = (x: number, z: number) => { const h = Math.sin(Math.floor(x / 70) * 127.1 + Math.floor(z / 70) * 311.7) * 43758.5453; return h - Math.floor(h); };
  const tiles = new Map<string, Plant[]>();
  const pick = new Map<Plant, Species>();
  for (const p of plants) {
    const u = (stand_(p.x, p.z) * 0.7 + rnd() * 0.3) * cum[cum.length - 1];
    const sp = kinds[Math.max(0, cum.findIndex(c => u < c))] ?? kinds[0];
    pick.set(p, sp);
    const key = `${sp},${Math.floor(p.x / TILE)},${Math.floor(p.z / TILE)}`;
    if (!tiles.has(key)) tiles.set(key, []);
    tiles.get(key)!.push(p);
  }
  const g = new THREE.Group(), m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), tint = new THREE.Color();
  for (const [key, list] of tiles) {
    const species = key.split(',')[0];
    const pair = (['hi', 'lo'] as const).map(lod => {
      const mesh = new THREE.InstancedMesh(stand, standMat, list.length);
      mesh.userData = { species, lod }; mesh.visible = lod === 'lo';
      // the GTAO pass renders everything with one override material, which knows nothing of alpha-tested cards
      mesh.onBeforeRender = (_r, scene) => { mesh.count = scene.overrideMaterial ? 0 : list.length; };
      mesh.onBeforeShadow = () => { mesh.count = list.length; };
      g.add(mesh); return mesh;
    });
    const r = mulberry(list.length * 7919 + key.length);
    list.forEach((p, k) => {
      m.compose(new THREE.Vector3(p.x, p.y, p.z), q.setFromAxisAngle(up, r() * 6.283), new THREE.Vector3(p.s, p.s * (0.9 + r() * 0.25), p.s));
      tint.setRGB(0.85 + r() * 0.25, 0.85 + r() * 0.25, 0.8 + r() * 0.2);
      for (const mesh of pair) { mesh.setMatrixAt(k, m); mesh.setColorAt(k, tint); }
    });
    for (const mesh of pair) mesh.computeBoundingSphere();
  }
  // each frame, before the next is drawn: detailed tiles only near the camera, none past the fog; wind clock
  const ticker = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial());
  ticker.frustumCulled = false;
  ticker.onBeforeRender = (_r, _s, cam) => {
    time.value = performance.now() / 1000;
    if (!g.userData.ready) return;
    for (const mesh of g.children as THREE.InstancedMesh[]) {
      if (!mesh.userData.lod) continue;
      const bs = mesh.boundingSphere!, d = Math.hypot(bs.center.x - cam.position.x, bs.center.z - cam.position.z);
      mesh.visible = mesh.userData.lod === 'hi' ? d - bs.radius < NEAR + FADE : d + bs.radius > NEAR - FADE && d - bs.radius < FAR;
    }
  };
  g.add(ticker);
  g.name = 'trees'; g.userData.count = plants.length;
  if (models) dress(g);
  else if (typeof window !== 'undefined') { waiting.add(g); loadTreeModels().catch(e => console.warn('tree models unavailable', e)); }
  return g;
}

function mulberry(a: number) {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
