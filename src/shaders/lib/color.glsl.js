// Shared colour + grading helpers. Components render in linear light; the
// compositor is the only place tone mapping and encoding happen, which keeps
// every clip on the same curve.

export const colorGLSL = /* glsl */ `
// Inigo Quilez style cosine palette: cheap, smooth, and easy to art-direct.
vec3 cosPalette(float t, vec3 a, vec3 b, vec3 c, vec3 d) {
  return a + b * cos(6.283185307179586 * (c * t + d));
}

// Three-stop ramp. More art-directable than a cosine palette when you want a
// specific set of colours rather than a spectrum.
vec3 ramp3(float t, vec3 a, vec3 b, vec3 c) {
  t = clamp(t, 0.0, 1.0);
  return t < 0.5 ? mix(a, b, smoothstep(0.0, 1.0, t * 2.0))
                 : mix(b, c, smoothstep(0.0, 1.0, (t - 0.5) * 2.0));
}

vec3 acesFilmic(vec3 x) {
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

vec3 linearToSRGB(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(max(c, 1e-5), vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// Triangular-PDF dither. Removes the banding that 8-bit output plus heavy
// social-platform compression would otherwise turn into visible contours.
vec3 tpdfDither(vec2 fragCoord, float seed) {
  float r1 = hash12(fragCoord + seed * 17.13);
  float r2 = hash12(fragCoord + seed * 41.77 + 91.3);
  return vec3(r1 - r2) / 255.0;
}
`;
