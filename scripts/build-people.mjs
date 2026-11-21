// Builds src/assets/person.glb and src/assets/anims.glb from Quaternius's CC0 packs:
//   Universal Base Characters [Standard] and Universal Animation Library [Standard] (quaternius.com, CC0).
// Usage (macOS, uses `sips` to shrink textures): node scripts/build-people.mjs <folder with both packs unzipped>
import { NodeIO } from '@gltf-transform/core';
import { prune, resample, dedup } from '@gltf-transform/functions';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, readdirSync, statSync, cpSync, existsSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const root = process.argv[2];
if (!root) throw new Error('usage: node scripts/build-people.mjs <packs folder>');
const find = (dir, name) => {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) { const r = find(p, name); if (r) return r; } else if (f === name) return p;
  }
};
const KEEP = ['Idle_Loop', 'Idle_Talking_Loop', 'Fixing_Kneeling', 'Crouch_Idle_Loop', 'Push_Loop', 'Driving_Loop', 'Dance_Loop', 'Jump_Loop'];
const io = new NodeIO();
const tmp = mkdtempSync(join(tmpdir(), 'people-'));

// character: keep base colour only, shrunk to JPEG; drop normal and roughness maps
// The pack's .gltf names two normal maps that ship as `X.png` rather than `X_png.png`; stage a copy with those
// names filled in (the normal maps are dropped below anyway).
const gltfPath = find(root, 'Superhero_Male_FullBody.gltf'), srcDir = join(gltfPath, '..'), stage = join(tmp, 'char');
cpSync(srcDir, stage, { recursive: true });
for (const img of JSON.parse(readFileSync(gltfPath, 'utf8')).images ?? [])
  if (!existsSync(join(stage, img.uri))) copyFileSync(join(stage, img.uri.replace('_png.png', '.png')), join(stage, img.uri));
const person = await io.read(join(stage, 'Superhero_Male_FullBody.gltf'));
for (const m of person.getRoot().listMaterials()) {
  m.setNormalTexture(null); m.setMetallicRoughnessTexture(null);
  const tex = m.getBaseColorTexture();
  if (!tex) continue;
  const src = join(tmp, `${m.getName()}.png`), out = join(tmp, `${m.getName()}.jpg`);
  writeFileSync(src, tex.getImage());
  execFileSync('sips', ['-Z', m.getName().includes('Eyes') ? '256' : '1024', '-s', 'format', 'jpeg', '-s', 'formatOptions', '80', src, '--out', out], { stdio: 'ignore' });
  tex.setImage(new Uint8Array(readFileSync(out))).setMimeType('image/jpeg').setURI('');
}
await person.transform(prune());
await io.write('src/assets/person.glb', person);

// animations: only the clips the game uses, no mannequin mesh
const anims = await io.read(find(root, 'UAL1_Standard.glb'));
for (const a of anims.getRoot().listAnimations()) if (!KEEP.includes(a.getName())) a.dispose();
for (const n of anims.getRoot().listNodes()) { n.setMesh(null); n.setSkin(null); }
await anims.transform(resample({ tolerance: 2e-3 }), dedup(), prune({ keepLeaves: true }));
// prune keeps the deleted clips' keyframe data (it's still attached to the root); drop anything no clip uses
const used = new Set(anims.getRoot().listAnimations().flatMap(a => a.listSamplers().flatMap(s => [s.getInput(), s.getOutput()])));
for (const acc of anims.getRoot().listAccessors()) if (!used.has(acc)) acc.dispose();
await io.write('src/assets/anims.glb', anims);
console.log('kept', anims.getRoot().listAnimations().map(a => a.getName()).join(', '));
