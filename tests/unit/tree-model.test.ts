import { describe, it, expect } from 'vitest';
import { existsSync, statSync } from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { getBounds } from '@gltf-transform/functions';
import { MeshoptDecoder } from 'meshoptimizer';
import { SPECIES } from '../../src/trees';

const path = 'src/assets/trees.glb';

describe('the Blender-built trees', async () => {
  it('are built and small enough to download on an iPad', () => {
    expect(existsSync(path)).toBe(true);
    expect(statSync(path).size).toBeLessThan(700_000);
  });

  await MeshoptDecoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  const doc = existsSync(path) ? await io.read(path) : null;
  const root = doc?.getRoot();
  const tris = (name: string) => root!.listMeshes().find(m => m.getName() === name)!.listPrimitives()
    .reduce((n, p) => n + (p.getIndices()?.getCount() ?? p.getAttribute('POSITION')!.getCount()) / 3, 0);
  const node = (name: string) => root!.listNodes().find(n => n.getName() === name)!;

  it.each(SPECIES)('has a detailed %s for near the camera and a cheap one for the distance', species => {
    const hi = tris(`${species}_hi`), lo = tris(`${species}_lo`);
    expect(hi).toBeGreaterThan(150); expect(hi).toBeLessThan(2500);
    expect(lo).toBeLessThan(250); expect(lo * 4).toBeLessThan(hi);
  });

  it.each(SPECIES)('every %s mesh carries normals, texture coordinates and shading colours', species => {
    for (const lod of ['hi', 'lo']) {
      const p = root!.listMeshes().find(m => m.getName() === `${species}_${lod}`)!.listPrimitives()[0];
      for (const a of ['POSITION', 'NORMAL', 'TEXCOORD_0', 'COLOR_0']) expect(p.getAttribute(a), `${species}_${lod} ${a}`).toBeTruthy();
    }
  });

  it.each(SPECIES)('the %s stands on the ground at the origin, tree-sized, both LODs the same size', species => {
    const hi = getBounds(node(`${species}_hi`)), lo = getBounds(node(`${species}_lo`));
    expect(hi.min[1]).toBeGreaterThan(-0.6); expect(hi.min[1]).toBeLessThan(0.05);
    expect(hi.max[1]).toBeGreaterThan(7); expect(hi.max[1]).toBeLessThan(26);
    expect(Math.abs(lo.max[1] - hi.max[1]) / hi.max[1]).toBeLessThan(0.15);
    expect(Math.abs((lo.max[0] - lo.min[0]) - (hi.max[0] - hi.min[0])) / (hi.max[0] - hi.min[0])).toBeLessThan(0.25);
  });

  it('shares one foliage texture atlas across every tree', () => {
    expect(root!.listTextures()).toHaveLength(1);
    expect(root!.listMaterials().map(m => m.getName())).toEqual(['foliage']);
  });
});
