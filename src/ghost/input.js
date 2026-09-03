import * as THREE from 'three';

// Keyboard plus pointer steering. Movement is expressed in screen space and
// then rotated into the world, so "up" always means up-screen no matter what
// the isometric camera is doing.
export class Input {
  constructor(domElement, camera) {
    this.dom = domElement;
    this.camera = camera;
    this.keys = new Set();
    this.pointerActive = false;
    this.pointerNdc = new THREE.Vector2();
    this.pointerWorld = new THREE.Vector3();
    this.jumpQueued = false;

    this.axis = { x: 0, y: 0, jump: false };
    this.raycaster = new THREE.Raycaster();
    this.plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

    this.#bind();
  }

  #bind() {
    const down = (e) => {
      if (e.code === 'Space') {
        e.preventDefault();
        this.jumpQueued = true;
      }
      this.keys.add(e.code);
    };
    const up = (e) => this.keys.delete(e.code);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', () => this.keys.clear());

    const move = (e) => {
      const r = this.dom.getBoundingClientRect();
      this.pointerNdc.set(
        ((e.clientX - r.left) / r.width) * 2 - 1,
        -((e.clientY - r.top) / r.height) * 2 + 1,
      );
    };
    this.dom.addEventListener('pointerdown', (e) => {
      this.dom.setPointerCapture?.(e.pointerId);
      this.pointerActive = true;
      move(e);
    });
    this.dom.addEventListener('pointermove', move);
    const release = () => { this.pointerActive = false; };
    this.dom.addEventListener('pointerup', release);
    this.dom.addEventListener('pointercancel', release);
    this.dom.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // Screen-space basis projected onto the ground plane.
  #basis() {
    const fwd = new THREE.Vector3();
    this.camera.getWorldDirection(fwd);
    fwd.y = 0;
    fwd.normalize();
    const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
    return { fwd, right };
  }

  sample(ghostPos) {
    const k = this.keys;
    let sx = 0;
    let sy = 0;
    if (k.has('KeyW') || k.has('ArrowUp')) sy += 1;
    if (k.has('KeyS') || k.has('ArrowDown')) sy -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) sx += 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) sx -= 1;

    const { fwd, right } = this.#basis();
    let x = right.x * sx + fwd.x * sy;
    let z = right.z * sx + fwd.z * sy;

    if (sx === 0 && sy === 0 && this.pointerActive && ghostPos) {
      // Steer toward the pointer's position on the ground, easing off as the
      // ghost arrives so it settles instead of jittering around the target.
      this.raycaster.setFromCamera(this.pointerNdc, this.camera);
      if (this.raycaster.ray.intersectPlane(this.plane, this.pointerWorld)) {
        const dx = this.pointerWorld.x - ghostPos.x;
        const dz = this.pointerWorld.z - ghostPos.z;
        const d = Math.hypot(dx, dz);
        if (d > 0.12) {
          const s = Math.min(d / 1.2, 1);
          x = (dx / d) * s;
          z = (dz / d) * s;
        }
      }
    }

    const len = Math.hypot(x, z);
    if (len > 1) { x /= len; z /= len; }

    this.axis.x = x;
    this.axis.y = z;
    this.axis.jump = this.jumpQueued;
    this.jumpQueued = false;
    return this.axis;
  }
}
