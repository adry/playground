import * as THREE from 'three';
import M, { LEFT_X, JOINTS, REST } from './metrics.js';
import { zombieMaterials, disposeMaterials, triangleCount } from './parts/forms.js';
import { mergeWithinNodes } from '../merge.js';
import { buildHead } from './parts/head.js';
import { buildTorso } from './parts/torso.js';
import { buildArm } from './parts/arms.js';
import { buildLower } from './parts/legs.js';
import { buildJacket } from './parts/clothes.js';

// The assembler. It owns no geometry of its own: the part modules build the
// shapes and this file parents them together, publishes the flat joint map,
// and then CHECKS that map against metrics.js before handing it over.
//
// Keeping it empty of modelling is the point, exactly as in the skeleton's
// model.js. Two agents can work on one character at once only while the seam
// between them stays this thin.
//
// THE JOINT MAP IS THE SKELETON'S JOINT MAP. Same names, same meanings, same
// jaw sign, same "identity at rest" rule. That is what lets the animation half
// reuse the skeleton's machinery rather than writing a second copy of it, and
// what will let a zombie and a skeleton share one performance later.

export function createZombieRig({ scale = 1 } = {}) {
  const materials = zombieMaterials();
  const parts = [];
  const track = (p) => { parts.push(p); return p; };

  const group = new THREE.Group();

  // root is the hips. Everything hangs off it, so hauling the character up out
  // of the ground is one translation on one node.
  const root = new THREE.Object3D();
  root.position.y = M.y.hip;
  group.add(root);

  const lower = track(buildLower({ materials }));
  root.add(lower.group);

  const torso = track(buildTorso({ materials }));
  root.add(torso.group);

  // The coat hangs from the shoulders and is authored in world heights, so it
  // goes into a frame that undoes spineUpper's offset.
  const jacket = track(buildJacket({ materials }));
  torso.frames.inUpper.add(jacket.group);

  // `head` is the animator's node above the skull, so a nod does not have to
  // fight whatever origin the head part chose for itself.
  const head = new THREE.Object3D();
  torso.anchors.atlas.add(head);
  const skull = track(buildHead({ materials }));
  head.add(skull.group);

  const armL = track(buildArm({ materials, side: 'L' }));
  const armR = track(buildArm({ materials, side: 'R' }));
  torso.anchors.shoulderL.add(armL.group);
  torso.anchors.shoulderR.add(armR.group);

  const joints = {
    root,
    spineLower: torso.joints.spineLower,
    spineUpper: torso.joints.spineUpper,
    neck: torso.joints.neck,
    head,
    jaw: skull.joints.jaw,
    shoulderL: armL.joints.shoulder,
    shoulderR: armR.joints.shoulder,
    elbowL: armL.joints.elbow,
    elbowR: armR.joints.elbow,
    wristL: armL.joints.wrist,
    wristR: armR.joints.wrist,
    hipL: lower.joints.hipL,
    hipR: lower.joints.hipR,
    kneeL: lower.joints.kneeL,
    kneeR: lower.joints.kneeR,
    ankleL: lower.joints.ankleL,
    ankleR: lower.joints.ankleR,
  };

  // The jaw's sign is PUBLISHED rather than documented, so an animator can
  // assert it instead of trusting a paragraph. The figure faces +Z, the chin
  // is below and in front of the hinge, and positive rotation.x drops it.
  joints.jaw.userData.openAxis = 'x';
  joints.jaw.userData.openSign = 1;

  group.updateMatrixWorld(true);

  // --- the contract is checked, not trusted ---------------------------------
  //
  // Two things go wrong when a figure is built by more than one person, and
  // both are invisible in the rest pose:
  //
  //  1. a part putting its L side at negative x, which comes out as a
  //     cross-limbed walk and nothing else. The skeleton shipped a pass with
  //     the shoulders on one convention and the hips on the other.
  //  2. metrics.js and the built scene graph drifting apart, so the animation
  //     half plans a stride against numbers the model no longer honours.
  //
  // Both are cheap to catch here and expensive to find later, so this throws.
  const world = new THREE.Vector3();
  for (const name of JOINTS) {
    const node = joints[name];
    if (!node) throw new Error(`zombie: joint '${name}' is missing from the rig.`);
    if (node.rotation.x || node.rotation.y || node.rotation.z) {
      throw new Error(`zombie: joint '${name}' is not identity at rest.`);
    }
    const want = REST[name];
    if (!want) continue;
    node.getWorldPosition(world);
    const off = Math.hypot(world.x - want[0], world.y - want[1], world.z - want[2]);
    // 1 mm at this scale. Tight enough to catch a wrong landmark, loose enough
    // that a bowed bone or a rounded cap does not trip it.
    if (off > 0.001) {
      throw new Error(
        `zombie: joint '${name}' is at (${world.x.toFixed(4)}, ${world.y.toFixed(4)}, ${world.z.toFixed(4)}), ` +
        `metrics.js REST says (${want.join(', ')}). One of the two is wrong.`);
    }
    if (name.endsWith('L') || name.endsWith('R')) {
      const wantSign = name.endsWith('L') ? LEFT_X : -LEFT_X;
      if (Math.sign(world.x) !== wantSign) {
        throw new Error(`zombie: ${name} is at x sign ${Math.sign(world.x)}, expected ${wantSign}. See LEFT_X in metrics.js.`);
      }
    }
  }

  // Detachable pieces, by the SAME names the skeleton publishes, so one shed
  // plan can drive either figure. Two ribs out of the open chest and two claw
  // fingers. A rib that leaves this cavity does not open a hole in the
  // silhouette, because what is behind it is the flesh column, which is
  // already what the gap between two ribs shows.
  const shed = new Map([...torso.shed, ...armL.shed, ...armR.shed]);

  // NO fake contact patch. Every mesh here casts a real shadow from the key
  // light, and that shadow knows which way the sun is; a flat decal does not,
  // so it darkens the lit side of a foot as much as the shadowed one and
  // slides out from under a foot that lifts. This is the fourth prop in the
  // scene to go without one, after the tombstones, the pumpkins and the
  // skeleton. The empty array stays published because the skeleton's
  // choreography reads it and treats "no patches" as nothing to do.
  group.userData.contactShadow = [];

  group.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });

  // --- one draw call per joint, not per piece --------------------------------
  //
  // This figure is authored as a pile of small closed volumes -- that is the
  // whole point of the rebuild -- and every one of them is a draw call, twice
  // over once the shadow pass has had its turn. A scene graph is the right way
  // to AUTHOR a body and the wrong way to DRAW one.
  //
  // `mergeWithinNodes` collapses the meshes under each node to one per
  // material and never merges ACROSS a node, so every joint still bends, every
  // shed piece is still there to be detached whole, and not a pixel changes.
  // The skeleton uses it to go from 544 meshes to 82. The win is asserted
  // rather than assumed: `group.userData.merge` publishes both counts.
  const before = triangleCount(group);
  const flattened = mergeWithinNodes(group);
  const after = triangleCount(group);
  if (after !== before) {
    throw new Error(`zombie: mergeWithinNodes changed the triangle count from ${before} to ${after}. It is meant to be lossless.`);
  }
  group.userData.merge = { meshesBefore: flattened.before, meshesAfter: flattened.after };

  group.userData.triangles = triangleCount(group);
  group.userData.height = M.height;

  group.scale.setScalar(scale);

  return {
    group,
    joints,
    shed,
    update() {},
    dispose() {
      for (const p of parts) p.dispose?.();
      // The buffers the merge created. The originals belong to `parts` above
      // and are freed by them, which is why the merge does not free them.
      for (const g of flattened.geometries) g.dispose();
      disposeMaterials(materials);
    },
  };
}

export default createZombieRig;
