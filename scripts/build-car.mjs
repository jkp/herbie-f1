// Builds src/assets/car.glb: models the car in Blender (scripts/blender/make_car.py), then shrinks it for the web.
// Usage: node scripts/build-car.mjs [preview.png]   (needs `blender` on PATH, or BLENDER=/path/to/blender)
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, weld, quantize, meshopt, prune } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const raw = join(mkdtempSync(join(tmpdir(), 'car-')), 'car-raw.glb'), out = 'src/assets/car.glb';
const blender = process.env.BLENDER ?? 'blender';
execFileSync(blender, ['-b', '-P', 'scripts/blender/make_car.py', '--', raw, ...process.argv.slice(2)], { stdio: ['ignore', 'inherit', 'inherit'] });

await MeshoptEncoder.ready; await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(raw);
// keepLeaves: the empty `number` node marks where the race number goes
await doc.transform(dedup(), weld(), prune({ keepLeaves: true }), quantize(), meshopt({ encoder: MeshoptEncoder, level: 'high' }));
await io.write(out, doc);
console.log(`${out}: ${(statSync(out).size / 1024).toFixed(0)} KB`);
