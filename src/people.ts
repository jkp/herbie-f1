// Animated people (pit crew, podium, the player's driver) from Quaternius's CC0 character and animation packs.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import personUrl from './assets/person.glb?url';
import animsUrl from './assets/anims.glb?url';

export type Part = 'skin' | 'suit' | 'glove' | 'boot';
const PART_CODE: Record<Part, number> = { skin: 0, suit: 1, glove: 2, boot: 3 };

/** What a body region wears, by its dominant bone: head bare, hands gloved, feet booted, the rest in the suit. */
export function partForBone(name: string): Part {
  if (/^(Head|neck_01)$/.test(name)) return 'skin';
  if (/^(hand|thumb|index|middle|ring|pinky)_/.test(name)) return 'glove';
  if (/^(foot|ball)_/.test(name)) return 'boot';
  return 'suit';
}

export interface PersonStyle { suit: number; gloves?: number; boots?: number; helmet?: number | null }
export interface Person {
  root: THREE.Group;
  bone(name: string): THREE.Bone;
  play(clip: string, fade?: number): void;
  update(dt: number): void;
}

const HEIGHT = 1.78;

export class People {
  private constructor(private model: THREE.Group, private clips: THREE.AnimationClip[]) {}

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
    return new People(model, anims.animations);
  }

  make(style: PersonStyle): Person {
    const root = new THREE.Group(), body = cloneSkinned(this.model) as THREE.Group;
    root.add(body);
    const bones = new Map<string, THREE.Bone>();
    const suit = new THREE.Color(style.suit), gloves = new THREE.Color(style.gloves ?? 0x16171a), boots = new THREE.Color(style.boots ?? 0x111111);
    body.traverse(o => {
      if ((o as THREE.Bone).isBone) bones.set(o.name, o as THREE.Bone);
      const m = o as THREE.SkinnedMesh;
      if (!m.isSkinnedMesh) return;
      m.castShadow = true; m.frustumCulled = false; // skinned bounds don't follow the animation
      const src = m.material as THREE.MeshStandardMaterial;
      if (!m.geometry.getAttribute('part')) return; // eyes, hair: keep as they are
      const mat = new THREE.MeshStandardMaterial({ map: src.map, roughness: 0.75 });
      mat.onBeforeCompile = sh => {
        Object.assign(sh.uniforms, { uSuit: { value: suit }, uGloves: { value: gloves }, uBoots: { value: boots } });
        sh.vertexShader = 'attribute float part;\nvarying float vPart;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvPart = part;');
        sh.fragmentShader = 'uniform vec3 uSuit, uGloves, uBoots;\nvarying float vPart;\n' + sh.fragmentShader.replace('#include <map_fragment>',
          '#include <map_fragment>\nif (vPart > 0.5) diffuseColor.rgb = vPart < 1.5 ? uSuit : vPart < 2.5 ? uGloves : uBoots;');
      };
      mat.customProgramCacheKey = () => 'person-suit';
      m.material = mat;
    });
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
