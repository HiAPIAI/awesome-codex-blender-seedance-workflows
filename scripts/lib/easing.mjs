// Deterministic animation-curve evaluation shared by the camera-rig baker and
// the object-track baker. Every named easing is expressed as a cubic Bezier so
// that a single, side-effect-free solver produces the same eased value for the
// same input on every platform. This is what lets a shot spec plus a seed
// reproduce byte-identical camera tracks, and it is deliberately independent of
// Blender's own F-curve interpolation (which the renderer no longer forces to
// LINEAR globally).

export const EASING_TYPES = Object.freeze([
  "LINEAR",
  "BEZIER",
  "EASE_IN",
  "EASE_OUT",
  "EASE_IN_OUT",
  "CONSTANT",
]);

// CSS-style control handles for the named eases. LINEAR and CONSTANT are handled
// analytically (identity / step) and never touch the solver.
const NAMED_HANDLES = Object.freeze({
  EASE_IN: [0.42, 0, 1, 1],
  EASE_OUT: [0, 0, 0.58, 1],
  EASE_IN_OUT: [0.42, 0, 0.58, 1],
});

// Normalize any accepted easing form into a canonical { type, handles? } record.
// Accepts: undefined (-> LINEAR), a bare type string, or { type, handles }.
export function normalizeEasing(spec) {
  if (spec === undefined || spec === null) return { type: "LINEAR" };
  if (typeof spec === "string") return { type: spec };
  const type = spec.type;
  if (type === "BEZIER" && Array.isArray(spec.handles)) {
    return { type, handles: spec.handles.map(Number) };
  }
  return { type };
}

// Evaluate an easing at normalized time t in [0, 1] and return the eased
// progress in [0, 1]. Callers snap exact keyframe endpoints to exact values, so
// this is only ever asked about strictly interior points; CONSTANT therefore
// holds the segment's start value (returns 0) until the next key is reached.
export function evalEasing(spec, t) {
  const easing = normalizeEasing(spec);
  const clamped = t <= 0 ? 0 : t >= 1 ? 1 : t;
  switch (easing.type) {
    case "LINEAR":
      return clamped;
    case "CONSTANT":
      return clamped >= 1 ? 1 : 0;
    case "BEZIER":
      return cubicBezierY(easing.handles ?? [0, 0, 1, 1], clamped);
    case "EASE_IN":
    case "EASE_OUT":
    case "EASE_IN_OUT":
      return cubicBezierY(NAMED_HANDLES[easing.type], clamped);
    default:
      // Unknown types are rejected during validation; fall back to LINEAR so a
      // late-arriving value can never throw inside the baker.
      return clamped;
  }
}

// True when a normalized easing is one the baker understands. Used by the spec
// validator so bad curve names fail before Blender ever runs.
export function isValidEasingType(type) {
  return EASING_TYPES.includes(type);
}

// Solve a cubic Bezier easing for its y given x (time). x1/x2 are constrained to
// [0, 1] for a well-defined, monotonic time mapping; y handles may overshoot.
function cubicBezierY([x1, y1, x2, y2], x) {
  if (!Number.isFinite(x1) || !Number.isFinite(y1) || !Number.isFinite(x2) || !Number.isFinite(y2)) {
    return x;
  }
  // Identity fast-path (LINEAR handles).
  if (x1 === 0 && y1 === 0 && x2 === 1 && y2 === 1) return x;
  const s = solveForParameter(x1, x2, x);
  return bezierAxis(y1, y2, s);
}

// One coordinate of a cubic Bezier whose endpoints are pinned at 0 and 1:
// B(s) = 3(1-s)^2 s * p1 + 3(1-s) s^2 * p2 + s^3.
function bezierAxis(p1, p2, s) {
  const oneMinus = 1 - s;
  return (3 * oneMinus * oneMinus * s * p1)
    + (3 * oneMinus * s * s * p2)
    + (s * s * s);
}

// Derivative of bezierAxis with respect to s, used for Newton-Raphson steps.
function bezierAxisSlope(p1, p2, s) {
  const oneMinus = 1 - s;
  return (3 * oneMinus * oneMinus * p1)
    + (6 * oneMinus * s * (p2 - p1))
    + (3 * s * s * (1 - p2));
}

// Find the Bezier parameter s such that x(s) == target, using Newton-Raphson
// with a bisection fallback for the flat regions where the slope vanishes.
function solveForParameter(x1, x2, target) {
  let s = target;
  for (let iteration = 0; iteration < 8; iteration += 1) {
    const x = bezierAxis(x1, x2, s) - target;
    if (Math.abs(x) < 1e-7) return s;
    const slope = bezierAxisSlope(x1, x2, s);
    if (Math.abs(slope) < 1e-7) break;
    s -= x / slope;
  }
  let low = 0;
  let high = 1;
  s = target;
  for (let iteration = 0; iteration < 40; iteration += 1) {
    const x = bezierAxis(x1, x2, s);
    if (Math.abs(x - target) < 1e-7) return s;
    if (x < target) low = s;
    else high = s;
    s = (low + high) / 2;
  }
  return s;
}

// Deterministic 32-bit PRNG (mulberry32). Given the same integer seed it always
// yields the same stream, which is what makes seeded handheld noise repeatable.
export function mulberry32(seed) {
  let state = (seed >>> 0) || 1;
  return function next() {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let result = Math.imul(state ^ (state >>> 15), 1 | state);
    result = (result + Math.imul(result ^ (result >>> 7), 61 | result)) ^ result;
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

// Seeded low-frequency value noise sampled once per frame. Random control points
// are placed every ~fps/frequency frames and smoothstep-interpolated, producing
// the slow, organic drift of a handheld operator rather than per-frame jitter.
// The result is a plain array so the baked track stays a pure function of
// (seed, frameCount, fps, frequency, amplitude).
export function lowFrequencyNoise({ seed, frameCount, fps, frequency, amplitude }) {
  const values = new Array(Math.max(0, frameCount)).fill(0);
  if (frameCount <= 0 || amplitude === 0) return values;
  const step = Math.max(1, Math.round(fps / Math.max(0.05, frequency)));
  const controlCount = Math.ceil((frameCount - 1) / step) + 2;
  const random = mulberry32(seed);
  const controls = Array.from({ length: controlCount }, () => (random() * 2 - 1) * amplitude);
  for (let frame = 0; frame < frameCount; frame += 1) {
    const position = frame / step;
    const index = Math.floor(position);
    const localT = position - index;
    const smooth = localT * localT * (3 - 2 * localT);
    const a = controls[index] ?? 0;
    const b = controls[index + 1] ?? a;
    values[frame] = a + (b - a) * smooth;
  }
  return values;
}
