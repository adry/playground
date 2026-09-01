// Quality tiers. Components read these multipliers instead of hard-coding
// counts, so the same scene runs at full weight on a real GPU and at a
// tractable weight inside a headless/software renderer.
export const TIERS = {
  high: { particles: 1.0, steps: 1.0, bloom: 5, label: 'high' },
  medium: { particles: 0.55, steps: 0.7, bloom: 4, label: 'medium' },
  draft: { particles: 0.3, steps: 0.5, bloom: 3, label: 'draft' },
};

export function tier(name) {
  return TIERS[name] || TIERS.high;
}
