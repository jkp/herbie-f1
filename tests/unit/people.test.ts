import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { partForBone } from '../../src/people';
import { pitTimeline } from '../../src/pitstop';
import { reachWith } from '../../src/ik';

describe('people', () => {
  it('dresses the body: bare head, gloved hands, boots, suit everywhere else', () => {
    expect(partForBone('Head')).toBe('skin');
    expect(partForBone('neck_01')).toBe('skin');
    expect(partForBone('hand_l')).toBe('glove');
    expect(partForBone('index_02_r')).toBe('glove');
    expect(partForBone('thumb_01_l')).toBe('glove');
    expect(partForBone('foot_r')).toBe('boot');
    expect(partForBone('spine_02')).toBe('suit');
    expect(partForBone('upperarm_l')).toBe('suit');
    expect(partForBone('thigh_r')).toBe('legs');
    expect(partForBone('calf_l')).toBe('legs');
  });
});

describe('pit stop timeline', () => {
  it('arrives, jacks up, swaps wheels, drops and releases, stationary for exactly the stop time', () => {
    const t = pitTimeline(2.4);
    const order = [t.arrive, t.jackUp, t.wheelsOff, t.wheelsOn, t.jackDown, t.go, t.end];
    for (let k = 1; k < order.length; k++) expect(order[k]).toBeGreaterThan(order[k - 1]);
    expect(t.go - t.arrive).toBeCloseTo(2.4, 5);
  });

  it('still fits a lightning-fast stop', () => {
    const t = pitTimeline(1.8);
    expect(t.wheelsOn).toBeGreaterThan(t.wheelsOff);
  });
});

describe('arm solver', () => {
  it('bends a two-bone arm so the hand reaches a target within reach', () => {
    const shoulder = new THREE.Bone(), elbow = new THREE.Bone(), hand = new THREE.Bone();
    shoulder.add(elbow); elbow.add(hand);
    elbow.position.set(0, -0.3, 0); hand.position.set(0, -0.28, 0);
    elbow.rotation.x = 0.4; // a natural bend to start from
    const scene = new THREE.Group(); scene.add(shoulder); scene.updateMatrixWorld(true);
    const target = new THREE.Vector3(0.25, -0.2, 0.3);
    reachWith(shoulder, elbow, hand, target);
    expect(hand.getWorldPosition(new THREE.Vector3()).distanceTo(target)).toBeLessThan(0.01);
  });
});
