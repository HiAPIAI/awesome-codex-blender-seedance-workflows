// Camera-rig and object-motion baker. Every camera rig (keyframed, dolly, crane,
// orbit, follow, handheld) and every animated object is reduced here to a single
// per-frame track sampled in FRAME space. Baking in JavaScript makes the track
// the one source of truth shared by three consumers that must agree exactly:
//   - the Blender renderer, which replays the samples with LINEAR interpolation
//     between frames (so an eased curve reproduces byte-for-byte);
//   - the telemetry pass, which differentiates the same samples for velocity,
//     angular rate, and framing; and
//   - the review visualisations.
// The baker is a pure function of the spec (and, for handheld, its seed), so the
// same spec always yields the same track. It never breaks legacy shots: a string
// rig plus camera.keyframes bakes with LINEAR defaults, matching the previous
// globally-linear render exactly.

import { evalEasing, lowFrequencyNoise } from "./easing.mjs";

const PROCEDURAL_RIGS = new Set(["dolly", "crane", "orbit", "follow", "handheld"]);
const HANDHELD_DEFAULTS = Object.freeze({
  frequency: 3,
  position: 0.06,
  roll: 1.6,
  rotation: 0.7,
});

// Map a keyframe time (seconds) to an integer render frame, identical to the
// mapping in spec.mjs so baked frames line up with the validator's frame checks.
export function frameAtTime(time, duration, fps) {
  return Math.min(duration * fps, 1 + Math.round(time * fps));
}

// Normalize the rig field into { type, ... } form. A bare string (or absent rig)
// is the legacy keyframed rig; an object carries its own structured type.
export function normalizeRig(rig) {
  if (rig === undefined || rig === null || typeof rig === "string") {
    return { type: "keyframed", label: typeof rig === "string" ? rig : "" };
  }
  if (typeof rig === "object" && typeof rig.type === "string" && PROCEDURAL_RIGS.has(rig.type)) {
    return { ...rig };
  }
  return { type: "keyframed", label: "" };
}

// Bake the whole shot: object tracks first (the camera may follow or aim at
// them), then the camera track. Returns per-frame samples plus the normalized
// rig descriptor used by the prompt and telemetry.
export function bakeShotTracks(spec) {
  const duration = spec.duration;
  const fps = spec.fps;
  const frameEnd = duration * fps;
  const frameStart = 1;
  const context = { duration, fps, frameStart, frameEnd };

  const objects = (spec.objects || []).map((object) => ({
    id: object.id,
    track: bakeObjectTrack(object, context),
  }));
  const objectsById = new Map(objects.map((entry) => [entry.id, entry]));

  const rig = normalizeRig(spec.camera?.rig);
  const camera = bakeCameraTrack(spec.camera, rig, context, objectsById);
  return { camera, objects, rig };
}

// A short human sentence describing the rig for the Seedance camera contract.
// Keyframed rigs return their original operator note unchanged so legacy prompts
// stay identical.
export function describeRig(rig) {
  const normal = normalizeRig(rig);
  switch (normal.type) {
    case "dolly":
      return `dolly move along a ${pointCount(normal.path)}-point track`;
    case "crane":
      return `crane move along a ${pointCount(normal.path)}-point vertical track`;
    case "orbit":
      return `orbit around [${(normal.center || [0, 0, 0]).join(", ")}] at radius ${normal.radius}`;
    case "follow":
      return `follow rig tracking "${normal.target}"`;
    case "handheld":
      return `handheld operator layered over a ${describeRig(normal.base ?? { type: "keyframed" })}`;
    default:
      return normal.label || "keyframed camera move";
  }
}

// ---------------------------------------------------------------------------
// Object tracks
// ---------------------------------------------------------------------------

function bakeObjectTrack(object, context) {
  const mapped = mapObjectKeyframes(object.keyframes || [], context);
  return sampleFrames(context, (frame) => {
    const location = sampleVectorKeyframes(mapped, frame, "location");
    const rotation = sampleVectorKeyframes(mapped, frame, "rotation");
    return { frame, time: timeOf(frame, context.fps), location, rotation };
  });
}

// Resolve authored keyframes into frame space with inherited rotation and a
// per-segment easing carried on the earlier keyframe of each segment.
function mapObjectKeyframes(keyframes, context) {
  let rotation = [0, 0, 0];
  return keyframes.map((keyframe) => {
    rotation = keyframe.rotation ? [...keyframe.rotation] : rotation;
    return {
      frame: frameAtTime(keyframe.time, context.duration, context.fps),
      location: [...keyframe.location],
      rotation: [...rotation],
      easing: keyframe.easing,
    };
  });
}

// ---------------------------------------------------------------------------
// Camera track
// ---------------------------------------------------------------------------

function bakeCameraTrack(camera, rig, context, objectsById) {
  const defaultLens = numberOr(camera?.lensMm, 35);
  if (rig.type === "keyframed") {
    return bakeKeyframedCamera(camera, context, defaultLens);
  }
  if (rig.type === "handheld") {
    return bakeHandheldCamera(camera, rig, context, objectsById, defaultLens);
  }
  return bakeProceduralCamera(camera, rig, context, objectsById, defaultLens);
}

function bakeKeyframedCamera(camera, context, defaultLens) {
  const easing = camera?.easing || {};
  const locationKfs = mapCameraChannel(camera.keyframes, context, (k) => k.location);
  const aimKfs = mapCameraChannel(camera.keyframes, context, (k) => k.target);
  const lensKfs = mapCameraChannel(camera.keyframes, context, (k) => [k.lensMm ?? defaultLens]);
  const focusSampler = makeFocusSampler(camera?.focus, easing.focus, context);
  const rollSampler = makeScalarSampler(camera?.roll, easing.rotation, context, 0);
  return sampleFrames(context, (frame) => {
    const location = sampleFrameKeyframes(locationKfs, frame, easing.location);
    const aim = separated(sampleFrameKeyframes(aimKfs, frame, easing.rotation), location);
    const lensMm = sampleFrameKeyframes(lensKfs, frame, easing.lens)[0];
    return assembleSample(frame, context, location, aim, lensMm, focusSampler, rollSampler);
  });
}

function bakeProceduralCamera(camera, rig, context, objectsById, defaultLens) {
  const easing = rig.easing || {};
  const locationEasing = rig.progress ?? easing.location;
  const geometry = makeGeometry(rig, context, objectsById);
  const locations = sampleFrames(context, (frame) => (
    geometry(evalEasing(locationEasing, rawProgress(frame, context)), frame)
  )).map((point) => point);
  const aims = resolveAims(rig.aim, {
    rig, locations, context, objectsById, rotationEasing: easing.rotation,
  });
  const lensSampler = makeScalarSampler(rig.lens ?? camera?.lensMm ?? defaultLens, easing.lens, context, defaultLens);
  const focusSampler = makeFocusSampler(rig.focus, easing.focus, context);
  const rollSampler = makeScalarSampler(rig.roll, easing.rotation, context, 0);
  return locations.map((location, index) => {
    const frame = context.frameStart + index;
    const aim = separated(aims[index], location);
    return assembleSample(frame, context, location, aim, lensSampler(frame), focusSampler, rollSampler, location, aim);
  });
}

function bakeHandheldCamera(camera, rig, context, objectsById, defaultLens) {
  const baseRig = normalizeRig(rig.base ?? { type: "keyframed" });
  const base = bakeCameraTrack(camera, baseRig, context, objectsById);
  const seed = integerOr(rig.seed, integerOr(rig.baseSeed, 1));
  const amplitude = rig.amplitude || {};
  const frequency = numberOr(rig.frequency, HANDHELD_DEFAULTS.frequency);
  const frameCount = base.length;
  const noiseArgs = { seed, frameCount, fps: context.fps, frequency };
  const nx = lowFrequencyNoise({ ...noiseArgs, seed: seed + 11, amplitude: numberOr(amplitude.position, HANDHELD_DEFAULTS.position) });
  const ny = lowFrequencyNoise({ ...noiseArgs, seed: seed + 23, amplitude: numberOr(amplitude.position, HANDHELD_DEFAULTS.position) });
  const nz = lowFrequencyNoise({ ...noiseArgs, seed: seed + 37, amplitude: numberOr(amplitude.position, HANDHELD_DEFAULTS.position) * 0.6 });
  const rollNoise = lowFrequencyNoise({ ...noiseArgs, seed: seed + 51, amplitude: numberOr(amplitude.roll, HANDHELD_DEFAULTS.roll) });
  const yawNoise = lowFrequencyNoise({ ...noiseArgs, seed: seed + 67, amplitude: numberOr(amplitude.rotation, HANDHELD_DEFAULTS.rotation) });
  const pitchNoise = lowFrequencyNoise({ ...noiseArgs, seed: seed + 83, amplitude: numberOr(amplitude.rotation, HANDHELD_DEFAULTS.rotation) });
  return base.map((sample, index) => {
    const location = [
      sample.location[0] + nx[index],
      sample.location[1] + ny[index],
      sample.location[2] + nz[index],
    ];
    const direction = sub(sample.aim, sample.location);
    const jittered = jitterDirection(direction, degToRad(yawNoise[index]), degToRad(pitchNoise[index]));
    const aim = separated(add(location, jittered), location);
    return {
      ...sample,
      location,
      aim,
      focusDistance: distance(location, aim),
      roll: sample.roll + rollNoise[index],
    };
  });
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

// Returns geometry(u, frame) -> world position, where u is the eased progress in
// [0, 1] for the location channel.
function makeGeometry(rig, context, objectsById) {
  if (rig.type === "orbit") {
    const center = rig.center || [0, 0, 0];
    const radius = numberOr(rig.radius, 1);
    const azimuth = range(rig.azimuth, 0);
    const elevation = range(rig.elevation, 0);
    const height = numberOr(rig.height, 0);
    return (u) => {
      const az = degToRad(lerp(azimuth.from, azimuth.to, u));
      const el = degToRad(lerp(elevation.from, elevation.to, u));
      const horizontal = radius * Math.cos(el);
      return [
        center[0] + horizontal * Math.cos(az),
        center[1] + horizontal * Math.sin(az),
        center[2] + radius * Math.sin(el) + height,
      ];
    };
  }
  if (rig.type === "follow") {
    return makeFollowGeometry(rig, context, objectsById);
  }
  // dolly and crane share polyline geometry; the distinction is authorial.
  const path = Array.isArray(rig.path) ? rig.path : [[0, 0, 0], [0, 0, 0]];
  return (u) => samplePolyline(path, u);
}

// Follow geometry cannot be expressed as a pure function of u because damping is
// stateful across frames, so it is pre-baked into a lookup keyed by frame.
function makeFollowGeometry(rig, context, objectsById) {
  const target = objectsById.get(rig.target);
  const offset = rig.offset || [0, 0, 0];
  const damping = clamp(numberOr(rig.damping, 0), 0, 0.99);
  const smoothing = 1 - damping;
  const frames = frameList(context);
  const positions = new Array(frames.length);
  let previous = null;
  frames.forEach((frame, index) => {
    const anchor = target ? locationAt(target.track, frame) : [0, 0, 0];
    const ideal = add(anchor, offset);
    previous = previous === null ? ideal : add(previous, scale(sub(ideal, previous), smoothing));
    positions[index] = previous;
  });
  return (_u, frame) => positions[frame - context.frameStart];
}

// ---------------------------------------------------------------------------
// Aim resolution
// ---------------------------------------------------------------------------

function resolveAims(aimConfig, { rig, locations, context, objectsById, rotationEasing }) {
  const config = normalizeAim(aimConfig, rig);
  const frames = frameList(context);
  if (config.mode === "point") {
    return frames.map(() => [...config.point]);
  }
  if (config.mode === "path") {
    return frames.map((frame) => samplePolyline(config.path, evalEasing(rotationEasing, rawProgress(frame, context))));
  }
  if (config.mode === "object") {
    const body = objectsById.get(config.id);
    const offset = config.offset || [0, 0, 0];
    return frames.map((frame) => add(body ? locationAt(body.track, frame) : [0, 0, 0], offset));
  }
  // lead: aim a fixed distance ahead along the actual direction of travel.
  return frames.map((frame, index) => {
    const forward = travelDirection(locations, index);
    return add(locations[index], scale(forward, config.distance));
  });
}

function normalizeAim(aimConfig, rig) {
  if (Array.isArray(aimConfig)) return { mode: "point", point: aimConfig };
  if (aimConfig && typeof aimConfig === "object") {
    if (aimConfig.mode === "path" && Array.isArray(aimConfig.path)) return { mode: "path", path: aimConfig.path };
    if (aimConfig.mode === "object" && typeof aimConfig.id === "string") return { mode: "object", id: aimConfig.id, offset: aimConfig.offset };
    if (aimConfig.mode === "lead") return { mode: "lead", distance: numberOr(aimConfig.distance, 5) };
    if (Array.isArray(aimConfig.point)) return { mode: "point", point: aimConfig.point };
  }
  // Sensible per-rig defaults when aim is omitted.
  if (rig.type === "orbit") return { mode: "point", point: rig.center || [0, 0, 0] };
  if (rig.type === "follow") {
    return { mode: "object", id: rig.target, offset: rig.lookOffset || [0, 0, 0] };
  }
  return { mode: "lead", distance: 5 };
}

// ---------------------------------------------------------------------------
// Channel samplers
// ---------------------------------------------------------------------------

function assembleSample(frame, context, location, aim, lensMm, focusSampler, rollSampler) {
  return {
    frame,
    time: timeOf(frame, context.fps),
    location,
    aim,
    lensMm,
    focusDistance: focusSampler(frame, location, aim),
    roll: rollSampler(frame),
  };
}

// A scalar channel: a constant number, or { from, to } eased across the take.
function makeScalarSampler(spec, easingSpec, context, fallback) {
  if (typeof spec === "number") return () => spec;
  if (spec && typeof spec === "object" && (spec.from !== undefined || spec.to !== undefined)) {
    const from = numberOr(spec.from, fallback);
    const to = numberOr(spec.to, from);
    return (frame) => lerp(from, to, evalEasing(easingSpec, rawProgress(frame, context)));
  }
  return () => fallback;
}

// Focus distance: constant number, { from, to } ramp, or (default) the live
// distance from the camera to whatever it is aiming at.
function makeFocusSampler(spec, easingSpec, context) {
  if (typeof spec === "number") return () => spec;
  if (spec && typeof spec === "object" && (spec.from !== undefined || spec.to !== undefined)) {
    const from = numberOr(spec.from, 1);
    const to = numberOr(spec.to, from);
    return (frame) => lerp(from, to, evalEasing(easingSpec, rawProgress(frame, context)));
  }
  return (_frame, location, aim) => distance(location, aim);
}

// ---------------------------------------------------------------------------
// Keyframe interpolation (frame space)
// ---------------------------------------------------------------------------

function mapCameraChannel(keyframes, context, pick) {
  return (keyframes || []).map((keyframe) => ({
    frame: frameAtTime(keyframe.time, context.duration, context.fps),
    value: pick(keyframe).map(Number),
  }));
}

function sampleFrameKeyframes(mapped, frame, easingSpec) {
  if (mapped.length === 0) return [0, 0, 0];
  if (frame <= mapped[0].frame) return [...mapped[0].value];
  const last = mapped[mapped.length - 1];
  if (frame >= last.frame) return [...last.value];
  for (let index = 1; index < mapped.length; index += 1) {
    const before = mapped[index - 1];
    const after = mapped[index];
    if (frame <= after.frame) {
      const span = after.frame - before.frame;
      const t = span === 0 ? 0 : (frame - before.frame) / span;
      const eased = evalEasing(easingSpec, t);
      return before.value.map((value, axis) => lerp(value, after.value[axis], eased));
    }
  }
  return [...last.value];
}

// Object keyframes carry per-segment easing on the earlier key of each segment.
function sampleVectorKeyframes(mapped, frame, key) {
  if (mapped.length === 0) return [0, 0, 0];
  if (frame <= mapped[0].frame) return [...mapped[0][key]];
  const last = mapped[mapped.length - 1];
  if (frame >= last.frame) return [...last[key]];
  for (let index = 1; index < mapped.length; index += 1) {
    const before = mapped[index - 1];
    const after = mapped[index];
    if (frame <= after.frame) {
      const span = after.frame - before.frame;
      const t = span === 0 ? 0 : (frame - before.frame) / span;
      const eased = evalEasing(before.easing, t);
      return before[key].map((value, axis) => lerp(value, after[key][axis], eased));
    }
  }
  return [...last[key]];
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function sampleFrames(context, produce) {
  return frameList(context).map((frame) => produce(frame));
}

function frameList(context) {
  const frames = [];
  for (let frame = context.frameStart; frame <= context.frameEnd; frame += 1) frames.push(frame);
  return frames;
}

function timeOf(frame, fps) {
  return Number(((frame - 1) / fps).toFixed(6));
}

function rawProgress(frame, context) {
  const span = context.frameEnd - context.frameStart;
  return span <= 0 ? 0 : (frame - context.frameStart) / span;
}

function locationAt(track, frame) {
  const index = frame - track[0].frame;
  const clamped = Math.min(track.length - 1, Math.max(0, index));
  return track[clamped].location;
}

function travelDirection(locations, index) {
  const previous = locations[Math.max(0, index - 1)];
  const next = locations[Math.min(locations.length - 1, index + 1)];
  const delta = sub(next, previous);
  const length = magnitude(delta);
  if (length < 1e-9) return [1, 0, 0];
  return scale(delta, 1 / length);
}

// Nudge the aim off the camera when they coincide so the look direction and the
// validator's minimum-separation rule are both satisfied.
function separated(aim, location) {
  if (distance(aim, location) >= 0.001) return aim;
  return [aim[0], aim[1], aim[2] + 1];
}

function range(spec, fallback) {
  if (typeof spec === "number") return { from: spec, to: spec };
  if (spec && typeof spec === "object") {
    const from = numberOr(spec.from, fallback);
    return { from, to: numberOr(spec.to, from) };
  }
  return { from: fallback, to: fallback };
}

function samplePolyline(points, u) {
  if (!Array.isArray(points) || points.length === 0) return [0, 0, 0];
  if (points.length === 1) return [...points[0]];
  const clamped = clamp(u, 0, 1);
  const lengths = [];
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    const segment = distance(points[index], points[index - 1]);
    lengths.push(segment);
    total += segment;
  }
  if (total < 1e-9) return [...points[0]];
  const targetLength = clamped * total;
  let accumulated = 0;
  for (let index = 0; index < lengths.length; index += 1) {
    if (accumulated + lengths[index] >= targetLength || index === lengths.length - 1) {
      const local = lengths[index] < 1e-9 ? 0 : (targetLength - accumulated) / lengths[index];
      return points[index].map((value, axis) => lerp(value, points[index + 1][axis], local));
    }
    accumulated += lengths[index];
  }
  return [...points[points.length - 1]];
}

function jitterDirection(direction, yaw, pitch) {
  const worldUp = [0, 0, 1];
  const afterYaw = rotateAroundAxis(direction, worldUp, yaw);
  let right = cross(afterYaw, worldUp);
  if (magnitude(right) < 1e-6) right = [1, 0, 0];
  return rotateAroundAxis(afterYaw, normalize(right), pitch);
}

// Rodrigues rotation of vector v around a unit axis by angle radians.
function rotateAroundAxis(v, axis, angle) {
  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);
  const dotAV = dot(axis, v);
  return [
    v[0] * cosA + (axis[1] * v[2] - axis[2] * v[1]) * sinA + axis[0] * dotAV * (1 - cosA),
    v[1] * cosA + (axis[2] * v[0] - axis[0] * v[2]) * sinA + axis[1] * dotAV * (1 - cosA),
    v[2] * cosA + (axis[0] * v[1] - axis[1] * v[0]) * sinA + axis[2] * dotAV * (1 - cosA),
  ];
}

function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function scale(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function magnitude(a) { return Math.sqrt(dot(a, a)); }
function normalize(a) { const m = magnitude(a); return m < 1e-9 ? [0, 0, 0] : scale(a, 1 / m); }
function distance(a, b) { return magnitude(sub(a, b)); }
function lerp(a, b, t) { return a + (b - a) * t; }
function clamp(value, low, high) { return value < low ? low : value > high ? high : value; }
function degToRad(deg) { return (deg * Math.PI) / 180; }
function numberOr(value, fallback) { return Number.isFinite(value) ? value : fallback; }
function integerOr(value, fallback) { return Number.isInteger(value) ? value : fallback; }
function pointCount(path) { return Array.isArray(path) ? path.length : 0; }
