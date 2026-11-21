import * as THREE from 'three';

const a = new THREE.Vector3(), b = new THREE.Vector3(), p = new THREE.Vector3(), e = new THREE.Vector3();
const q = new THREE.Quaternion(), pq = new THREE.Quaternion(), bq = new THREE.Quaternion();

/** Rotate `upper` and `lower` (cyclic coordinate descent) so `end` reaches `target` (world space). */
export function reachWith(upper: THREE.Object3D, lower: THREE.Object3D, end: THREE.Object3D, target: THREE.Vector3, iterations = 12) {
  for (let it = 0; it < iterations; it++) {
    for (const bone of [lower, upper]) {
      bone.updateWorldMatrix(true, true);
      bone.getWorldPosition(p); end.getWorldPosition(e);
      a.subVectors(e, p).normalize(); b.subVectors(target, p).normalize();
      if (a.dot(b) > 0.99999) continue;
      q.setFromUnitVectors(a, b);
      // world-space rotation q applied on top of the bone's world rotation, expressed in its parent's frame
      bone.parent!.getWorldQuaternion(pq); bone.getWorldQuaternion(bq);
      bone.quaternion.copy(pq.invert().multiply(q).multiply(bq));
    }
    end.updateWorldMatrix(true, false);
    if (end.getWorldPosition(e).distanceTo(target) < 0.002) break;
  }
}
