import { describe, it, expect } from 'vitest';
import { existsSync, statSync } from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { getBounds } from '@gltf-transform/functions';
import { MeshoptDecoder } from 'meshoptimizer';

const path = 'src/assets/car.glb';

describe('the Blender-built car model', async () => {
  it('is built and small enough to download on an iPad', () => {
    expect(existsSync(path)).toBe(true);
    expect(statSync(path).size).toBeLessThan(400_000);
  });

  await MeshoptDecoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  const doc = existsSync(path) ? await io.read(path) : null;
  const root = doc?.getRoot();

  it('has the materials the game recolours per team and per tyre compound', () => {
    const names = root!.listMaterials().map(m => m.getName());
    for (const n of ['paint', 'accent', 'carbon', 'tyre', 'rim', 'stripe', 'helmet', 'visor']) expect(names).toContain(n);
  });

  it('has four wheel assemblies at the hubs, a helmet and a nose number spot', () => {
    const node = (n: string) => root!.listNodes().find(x => x.getName() === n);
    const hubs = { wheel_FL: [1.85, 0.82], wheel_FR: [1.85, -0.82], wheel_RL: [-1.75, 0.82], wheel_RR: [-1.75, -0.82] };
    for (const [name, [x, z]] of Object.entries(hubs)) {
      const [px, py, pz] = node(name)!.getTranslation();
      expect(px, name).toBeCloseTo(x, 2); expect(py, name).toBeCloseTo(0.36, 2); expect(pz, name).toBeCloseTo(z, 2);
    }
    expect(node('helmet')).toBeDefined();
    expect(node('number')).toBeDefined();
  });

  it('is the size of a 2022 F1 car, nose along +x, sitting on the ground', () => {
    const { min, max } = getBounds(root!.listScenes()[0]);
    expect(max[0] - min[0]).toBeGreaterThan(5.3); expect(max[0] - min[0]).toBeLessThan(5.8);
    expect(max[2] - min[2]).toBeGreaterThan(1.9); expect(max[2] - min[2]).toBeLessThan(2.1);
    expect(min[1]).toBeGreaterThan(-0.02); expect(min[1]).toBeLessThan(0.02);
    expect(max[1]).toBeGreaterThan(0.9); expect(max[1]).toBeLessThan(1.15);
    expect(max[0]).toBeGreaterThan(3);
  });

  it('stays light enough for 20 cars at once', () => {
    let tris = 0;
    for (const mesh of root!.listMeshes()) for (const p of mesh.listPrimitives()) tris += (p.getIndices()?.getCount() ?? p.getAttribute('POSITION')!.getCount()) / 3;
    expect(tris).toBeGreaterThan(15_000);
    expect(tris).toBeLessThan(45_000);
  });
});
