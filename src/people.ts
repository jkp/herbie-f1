// Animated people (pit crew, podium, the player's driver) from Quaternius's CC0 character and animation packs.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import personUrl from './assets/person.glb?url';
import animsUrl from './assets/anims.glb?url';

export type Part = 'skin' | 'suit' | 'legs' | 'glove' | 'boot';
const PART_CODE: Record<Part, number> = { skin: 0, suit: 1, legs: 2, glove: 3, boot: 4 };

/** What a body region wears, by its dominant bone: head bare, hands gloved, feet booted, legs in trousers, the rest in the suit top. */
export function partForBone(name: string): Part {
  if (/^(Head|neck_01)$/.test(name)) return 'skin';
  if (/^(hand|thumb|index|middle|ring|pinky)_/.test(name)) return 'glove';
  if (/^(foot|ball)_/.test(name)) return 'boot';
  if (/^(thigh|calf)_/.test(name)) return 'legs';
  return 'suit';
}

export interface PersonStyle {
  suit: number; legs?: number; gloves?: number; boots?: number; helmet?: number | null;
  skin?: number; hair?: number; hairColor?: number; // skin tone (sRGB hex), index into HAIRSTYLES, hair colour (hex)
}
export const SKIN_TONES = [0xf3cfb3, 0xe3b08c, 0xc98f63, 0xa06a43, 0x74472a, 0x4a2c1b];
export const HAIRSTYLES = ['Short', 'Buzz', 'Curly', 'Long', 'Mohawk', 'Bald'];
export const HAIR_COLOURS = [
  { name: 'Black', color: 0x16110d }, { name: 'Brown', color: 0x4b2d1a }, { name: 'Blonde', color: 0xd6b26a },
  { name: 'Ginger', color: 0xb4521e }, { name: 'Grey', color: 0x9c9c9c },
];
export interface Person {
  root: THREE.Group;
  bone(name: string): THREE.Bone;
  play(clip: string, fade?: number): void;
  update(dt: number): void;
}

const HEIGHT = 1.78, SKULL = 0.105; // standing height; skull radius

export class People {
  private constructor(private model: THREE.Group, private clips: THREE.AnimationClip[], private inflate: number, private skinRef: number) {}

  static async load() {
    const loader = new GLTFLoader();
    const [person, anims] = await Promise.all([loader.loadAsync(personUrl), loader.loadAsync(animsUrl)]);
    const model = person.scene;
    // tag every body vertex with the clothing part of its strongest bone
    model.traverse(o => {
      const m = o as THREE.SkinnedMesh;
      if (!m.isSkinnedMesh || m.geometry.getAttribute('part')) return;
      const idx = m.geometry.getAttribute('skinIndex'), w = m.geometry.getAttribute('skinWeight');
      const part = new Float32Array(idx.count);
      for (let v = 0; v < idx.count; v++) {
        let best = 0;
        for (let k = 1; k < 4; k++) if (w.getComponent(v, k) > w.getComponent(v, best)) best = k;
        part[v] = PART_CODE[partForBone(m.skeleton.bones[idx.getComponent(v, best)].name)];
      }
      m.geometry.setAttribute('part', new THREE.BufferAttribute(part, 1));
    });
    const box = new THREE.Box3().setFromObject(model);
    model.scale.multiplyScalar(HEIGHT / (box.max.y - box.min.y));
    // clothes stand ~2.5 cm off the skin; work that out in the mesh's own units
    model.updateMatrixWorld(true);
    let meshScale = 1;
    model.traverse(o => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) meshScale = o.getWorldScale(new THREE.Vector3()).x; });
    return new People(model, anims.animations, 0.025 / meshScale, skinLuminance(model));
  }

  make(style: PersonStyle): Person {
    const root = new THREE.Group(), body = cloneSkinned(this.model) as THREE.Group;
    root.add(body);
    const bones = new Map<string, THREE.Bone>();
    const skin = new THREE.Color(style.skin ?? 0xffffff), skinRef = style.skin == null ? 0 : this.skinRef;
    const suit = new THREE.Color(style.suit), legs = new THREE.Color(style.legs ?? style.suit), gloves = new THREE.Color(style.gloves ?? 0x16171a), boots = new THREE.Color(style.boots ?? 0x111111);
    body.traverse(o => {
      if ((o as THREE.Bone).isBone) bones.set(o.name, o as THREE.Bone);
      const m = o as THREE.SkinnedMesh;
      if (!m.isSkinnedMesh) return;
      m.castShadow = true; m.frustumCulled = false; // skinned bounds don't follow the animation
      const src = m.material as THREE.MeshStandardMaterial;
      if (!m.geometry.getAttribute('part')) return; // eyes, hair: keep as they are
      const mat = new THREE.MeshStandardMaterial({ map: src.map, roughness: 0.75 });
      const inflate = this.inflate;
      mat.onBeforeCompile = sh => {
        Object.assign(sh.uniforms, { uSkin: { value: skin }, uSkinRef: { value: skinRef }, uSuit: { value: suit }, uLegs: { value: legs }, uGloves: { value: gloves }, uBoots: { value: boots }, uInflate: { value: inflate } });
        // clothed parts are pushed out along the normal so they read as loose fabric rather than painted skin
        sh.vertexShader = 'attribute float part;\nvarying float vPart;\nuniform float uInflate;\n' + sh.vertexShader.replace('#include <begin_vertex>',
          '#include <begin_vertex>\nvPart = part;\nif (part > 0.5 && part < 2.5) transformed += objectNormal * uInflate;');
        // skin: the chosen tone, keeping the texture's shading (relative to its average skin brightness)
        sh.fragmentShader = 'uniform vec3 uSuit, uLegs, uGloves, uBoots, uSkin;\nuniform float uSkinRef;\nvarying float vPart;\n' + sh.fragmentShader.replace('#include <map_fragment>',
          '#include <map_fragment>\nif (vPart > 0.5) diffuseColor.rgb = vPart < 1.5 ? uSuit : vPart < 2.5 ? uLegs : vPart < 3.5 ? uGloves : uBoots;\n'
          + 'else if (uSkinRef > 0.0) diffuseColor.rgb = uSkin * clamp(dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722)) / uSkinRef, 0.55, 1.5);');
      };
      mat.customProgramCacheKey = () => 'person-suit';
      m.material = mat;
    });
    if (style.hair != null && style.helmet == null) {
      const hair = makeHair(style.hair, style.hairColor ?? HAIR_COLOURS[0].color), head = bones.get('Head')!;
      root.updateMatrixWorld(true);
      // centred in the skull: just under the top of the head, above the head bone (in metres, unscaled)
      const h = head.getWorldPosition(new THREE.Vector3());
      hair.position.set(h.x, HEIGHT - SKULL, h.z + 0.012);
      root.add(hair); hair.updateMatrixWorld(true); head.attach(hair);
    }
    if (style.helmet != null) {
      const head = bones.get('Head')!;
      body.updateMatrixWorld(true);
      const helmet = new THREE.Group();
      const shell = new THREE.Mesh(new THREE.SphereGeometry(0.15, 20, 14), new THREE.MeshPhysicalMaterial({ color: style.helmet, roughness: 0.3, clearcoat: 1 }));
      const visor = new THREE.Mesh(new THREE.SphereGeometry(0.152, 20, 8, -0.95, 1.9, 1.15, 0.55), new THREE.MeshStandardMaterial({ color: 0x0b0b10, roughness: 0.1, metalness: 0.9 }));
      visor.rotation.y = Math.PI / 2; // face forward (+z on the model)
      shell.castShadow = true;
      helmet.add(shell, visor);
      // place the helmet over the skull in world terms, then reparent to the head bone so it follows the animation
      const headPos = head.getWorldPosition(new THREE.Vector3());
      helmet.position.copy(headPos).add(new THREE.Vector3(0, 0.1, 0.01));
      body.add(helmet); helmet.updateMatrixWorld(true);
      head.attach(helmet);
    }
    const mixer = new THREE.AnimationMixer(body);
    let current: THREE.AnimationAction | null = null;
    return {
      root,
      bone: name => bones.get(name)!,
      play: (name, fade = 0.25) => {
        const clip = this.clips.find(c => c.name === name);
        if (!clip) throw new Error(`no animation ${name}`);
        const next = mixer.clipAction(clip);
        if (next === current) return;
        next.reset().play();
        if (current) next.crossFadeFrom(current, fade, false);
        current = next;
      },
      update: dt => mixer.update(dt),
    };
  }
}

/** Average brightness (linear) of the body texture where the skin is, so a chosen tone keeps the texture's shading. */
function skinLuminance(model: THREE.Group) {
  let sum = 0, n = 0;
  model.traverse(o => {
    const m = o as THREE.SkinnedMesh, map = (m.material as THREE.MeshStandardMaterial)?.map, part = m.geometry?.getAttribute('part');
    if (!m.isSkinnedMesh || !map?.image || !part) return;
    const img = map.image as CanvasImageSource & { width: number; height: number };
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d', { willReadFrequently: true })!; g.drawImage(img, 0, 0, 128, 128);
    const px = g.getImageData(0, 0, 128, 128).data, uv = m.geometry.getAttribute('uv');
    const lin = (v: number) => (v / 255) ** 2.2;
    for (let v = 0; v < part.count; v += 7) {
      if (part.getX(v) !== 0) continue;
      const x = Math.min(127, Math.max(0, Math.floor(uv.getX(v) * 128))), y = Math.min(127, Math.max(0, Math.floor((map.flipY ? 1 - uv.getY(v) : uv.getY(v)) * 128)));
      const k = (y * 128 + x) * 4;
      sum += 0.2126 * lin(px[k]) + 0.7152 * lin(px[k + 1]) + 0.0722 * lin(px[k + 2]); n++;
    }
  });
  return n ? sum / n : 0.1;
}

/** A hairstyle around the skull, in the head bone's world frame (model faces +z, up +y), centred on the head bone. */
function makeHair(style: number, color: number) {
  const g = new THREE.Group(), mat = new THREE.MeshStandardMaterial({ color, roughness: 0.85 });
  const name = HAIRSTYLES[style] ?? 'Short';
  const cap = (r: number, down = 1.45) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 24, 14, 0, Math.PI * 2, 0, down), mat);
    m.position.set(0, -0.018, -0.012); m.rotation.x = -0.5; m.scale.set(1, 1, 1.12); m.castShadow = true; return m;
  };
  if (name === 'Short') g.add(cap(0.112));
  if (name === 'Buzz') g.add(cap(0.106, 1.5));
  if (name === 'Curly') {
    g.add(cap(0.108));
    const curl = new THREE.IcosahedronGeometry(0.028, 0);
    for (let k = 0; k < 70; k++) {
      const th = Math.acos(1 - (k + 0.5) / 70 * 1.35), ph = k * 2.39996;
      const v = new THREE.Vector3(Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph));
      v.applyAxisAngle(new THREE.Vector3(1, 0, 0), -0.45);
      const m = new THREE.Mesh(curl, mat); m.position.copy(v.multiplyScalar(0.115)).add(new THREE.Vector3(0, 0, -0.01)); g.add(m);
    }
  }
  if (name === 'Long') {
    g.add(cap(0.113));
    const back = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.085, 0.24, 20, 1, true, Math.PI * 0.55, Math.PI * 0.9), mat);
    back.material = mat.clone(); (back.material as THREE.Material).side = THREE.DoubleSide;
    back.position.set(0, -0.1, -0.03); back.rotation.y = Math.PI; g.add(back);
  }
  if (name === 'Mohawk') {
    g.add(cap(0.104, 1.5));
    const crest = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.045, 0.2), mat); crest.position.set(0, 0.098, -0.02); crest.rotation.x = -0.25; g.add(crest);
  }
  return g;
}
