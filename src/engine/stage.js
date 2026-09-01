import * as THREE from 'three';
import { Compositor } from './compositor.js';
import { tier } from './quality.js';

// The Stage owns the renderer and drives a component through the pipeline.
//
// Time is never read from a wall clock inside a component. Every frame is a
// pure function of `phase` (0..1 across the loop), which is what makes the
// preview, a re-render and an exported video byte-identical, and what lets the
// recorder step frames as slowly as it needs to without the motion changing.

export class Stage {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.quality = tier(options.quality || 'high');

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false, // handled by supersampling in the accumulation buffer
      alpha: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: options.preserveDrawingBuffer ?? false,
    });
    this.renderer.autoClear = false;
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace; // we encode ourselves
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.setClearColor(0x000000, 1);

    this.compositor = new Compositor(this.renderer, { bloomLevels: this.quality.bloom });

    this.component = null;
    this.width = 0;
    this.height = 0;
    this.pixelRatio = options.pixelRatio ?? 1;
  }

  async load(factory) {
    if (this.component) {
      this.component.dispose?.();
      this.component = null;
    }
    const component = factory();
    await component.init({
      renderer: this.renderer,
      quality: this.quality,
      width: this.width,
      height: this.height,
    });
    this.compositor.applyGrade(component.grade || {});
    this.component = component;
    if (this.width && this.height) component.resize?.(this.width, this.height);
    return component;
  }

  setSize(width, height, pixelRatio = this.pixelRatio) {
    this.pixelRatio = pixelRatio;
    this.width = Math.max(2, Math.round(width * pixelRatio));
    this.height = Math.max(2, Math.round(height * pixelRatio));

    this.renderer.setPixelRatio(1);
    this.renderer.setSize(width, height, false);
    this.canvas.width = this.width;
    this.canvas.height = this.height;
    this.renderer.setSize(this.width, this.height, false);

    this.compositor.setSize(this.width, this.height, this.quality.bloom);
    this.component?.resize?.(this.width, this.height);
  }

  get duration() {
    return this.component?.duration ?? 6;
  }

  // Render one output frame at absolute time `t`.
  //
  // `subframes` > 1 splits the exposure across the shutter interval and averages
  // the result: genuine motion blur rather than a per-object velocity fake, so
  // fast-moving detail stays coherent instead of strobing at 60fps.
  renderFrame(t, options = {}) {
    const component = this.component;
    if (!component) return;

    const subframes = Math.max(1, options.subframes ?? 1);
    const dt = options.dt ?? 1 / 60;
    const shutter = options.shutter ?? 0.5;
    const duration = component.duration;
    const target = options.target ?? null;

    this.compositor.beginFrame();

    for (let i = 0; i < subframes; i++) {
      const offset = subframes === 1 ? 0 : shutter * dt * ((i + 0.5) / subframes - 0.5);
      const st = t + offset;
      const phase = ((st % duration) + duration) / duration % 1;
      component.render(this.renderer, this.compositor.sceneTarget, {
        t: st,
        phase,
        dt,
        width: this.width,
        height: this.height,
      });
      this.compositor.accumulate(1 / subframes);
    }

    this.compositor.present(target, options.seed ?? 0);
  }

  // Convenience for components: clear and draw a scene into the pipeline target.
  static draw(renderer, target, scene, camera) {
    renderer.setRenderTarget(target);
    renderer.clear(true, true, true);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
  }

  dispose() {
    this.component?.dispose?.();
    this.compositor.dispose();
    this.renderer.dispose();
  }
}
