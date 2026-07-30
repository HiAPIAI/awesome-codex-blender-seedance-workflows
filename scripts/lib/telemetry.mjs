// Camera telemetry. Differentiates the baked camera track (position -> velocity
// -> acceleration -> jerk), derives orientation (pan/tilt/roll and their rates),
// and, when a subject is named, projects it through a pinhole model matching
// Blender's AUTO sensor fit to report on-screen framing, edge margin, and a
// coarse occlusion estimate. Thresholds are configurable and, by default, only
// raise warnings: a deliberate whip-pan or a subject exiting frame is a creative
// choice, not a failure, so telemetry flags it for human review rather than
// blocking the render.

const DEFAULT_THRESHOLDS = Object.freeze({
  speed: 12, // metres/second
  acceleration: 40, // metres/second^2
  jerk: 600, // metres/second^3
  angularVelocity: 120, // degrees/second
  horizon: 15, // degrees of roll from level
});

export function defaultTelemetryThresholds() {
  return { ...DEFAULT_THRESHOLDS };
}

// Build the versioned telemetry document from a bake result and its spec.
export function computeTelemetry({ camera, objects, spec }) {
  const fps = spec.fps;
  const dt = 1 / fps;
  const frameStart = camera.length ? camera[0].frame : 1;
  const frameEnd = camera.length ? camera[camera.length - 1].frame : 1;
  const thresholds = { ...DEFAULT_THRESHOLDS, ...(spec.camera?.telemetry?.thresholds || {}) };

  const positions = camera.map((sample) => sample.location);
  const velocity = derivative(positions, dt);
  const acceleration = derivative(velocity, dt);
  const jerk = derivative(acceleration, dt);

  const orientation = camera.map((sample) => orientationOf(sample));
  const pan = orientation.map((entry) => entry.pan);
  const tilt = orientation.map((entry) => entry.tilt);
  const panRate = angularRate(pan, dt, true);
  const tiltRate = angularRate(tilt, dt, false);

  const subject = resolveSubject(spec, objects);
  const occluders = buildOccluders(spec, objects, subject);

  const frames = camera.map((sample, index) => {
    const frame = {
      frame: sample.frame,
      time: sample.time,
      position: round3(sample.location),
      velocity: round3(velocity[index]),
      speed: round(magnitude(velocity[index])),
      acceleration: round3(acceleration[index]),
      accelerationMagnitude: round(magnitude(acceleration[index])),
      jerkMagnitude: round(magnitude(jerk[index])),
      pan: round(pan[index]),
      tilt: round(tilt[index]),
      roll: round(sample.roll),
      panRate: round(panRate[index]),
      tiltRate: round(tiltRate[index]),
      angularVelocity: round(Math.hypot(panRate[index], tiltRate[index])),
      horizonTilt: round(Math.abs(sample.roll)),
    };
    if (subject) {
      frame.subject = projectSubject(sample, subjectPositionAt(subject, sample.frame, frameStart), {
        sensorWidthMm: numberOr(spec.camera?.sensorWidthMm, 36),
        width: spec.resolution.width,
        height: spec.resolution.height,
        occluders,
      });
    }
    return frame;
  });

  const anomalies = detectAnomalies(frames, thresholds, subject);
  return {
    version: 1,
    shotId: spec.id,
    fps,
    frameStart,
    frameEnd,
    sensorWidthMm: numberOr(spec.camera?.sensorWidthMm, 36),
    subject: subject ? subject.descriptor : null,
    thresholds,
    frames,
    anomalies,
    summary: summarize(frames, anomalies, subject),
  };
}

// ---------------------------------------------------------------------------
// Orientation
// ---------------------------------------------------------------------------

function orientationOf(sample) {
  const direction = sub(sample.aim, sample.location);
  const horizontal = Math.hypot(direction[0], direction[1]);
  const pan = radToDeg(Math.atan2(direction[1], direction[0]));
  const tilt = radToDeg(Math.atan2(direction[2], horizontal));
  return { pan, tilt };
}

// Angular rate in degrees/second. Pan wraps at +/-180 so a move across the
// -180/180 seam reports the short way round instead of a spurious spike.
function angularRate(angles, dt, wrap) {
  const rate = new Array(angles.length).fill(0);
  for (let index = 1; index < angles.length; index += 1) {
    let delta = angles[index] - angles[index - 1];
    if (wrap) {
      while (delta > 180) delta -= 360;
      while (delta < -180) delta += 360;
    }
    rate[index] = delta / dt;
  }
  if (rate.length > 1) rate[0] = rate[1];
  return rate;
}

// ---------------------------------------------------------------------------
// Subject projection
// ---------------------------------------------------------------------------

function resolveSubject(spec, objects) {
  const config = spec.camera?.telemetry?.subject;
  if (!config) return null;
  if (typeof config.object === "string") {
    const body = objects.find((entry) => entry.id === config.object);
    if (!body) return null;
    return { kind: "object", track: body.track, descriptor: { object: config.object } };
  }
  if (Array.isArray(config.point)) {
    return { kind: "point", point: config.point.map(Number), descriptor: { point: config.point } };
  }
  return null;
}

function subjectPositionAt(subject, frame, frameStart) {
  if (subject.kind === "point") return subject.point;
  const index = Math.min(subject.track.length - 1, Math.max(0, frame - subject.track[0].frame));
  return subject.track[index].location;
}

function buildOccluders(spec, objects, subject) {
  if (!subject) return [];
  const subjectId = subject.descriptor.object;
  return (spec.objects || [])
    .map((object) => {
      const baked = objects.find((entry) => entry.id === object.id);
      if (!baked || object.id === subjectId) return null;
      const radius = Math.max(...object.dimensions) / 2;
      return { id: object.id, track: baked.track, radius };
    })
    .filter(Boolean);
}

// Pinhole projection into normalized device coordinates in [-1, 1], where the
// frame edges are +/-1. The sensor is fitted AUTO: the wider pixel axis takes the
// full sensor width and the other axis is scaled by aspect, matching Blender.
function projectSubject(sample, subjectPoint, { sensorWidthMm, width, height, occluders }) {
  const forward = normalize(sub(sample.aim, sample.location));
  let right = cross(forward, [0, 0, 1]);
  if (magnitude(right) < 1e-6) right = [1, 0, 0];
  right = normalize(right);
  let up = cross(right, forward);
  // Apply camera roll around the view axis.
  const rollRad = degToRad(sample.roll);
  right = rotateAroundAxis(right, forward, rollRad);
  up = rotateAroundAxis(up, forward, rollRad);

  const relative = sub(subjectPoint, sample.location);
  const depth = dot(relative, forward);
  const distanceToSubject = magnitude(relative);
  const fit = Math.max(width, height);
  const sensorX = sensorWidthMm * (width / fit);
  const sensorY = sensorWidthMm * (height / fit);
  const focal = sample.lensMm;
  const result = {
    distance: round(distanceToSubject),
    depth: round(depth),
    inFrame: false,
    ndcX: null,
    ndcY: null,
    screenX: null,
    screenY: null,
    edgeMargin: round(-1),
    occluded: false,
    occluder: null,
  };
  if (depth <= 1e-6) return result; // behind the camera
  const camX = dot(relative, right);
  const camY = dot(relative, up);
  const ndcX = (focal * camX) / (depth * (sensorX / 2));
  const ndcY = (focal * camY) / (depth * (sensorY / 2));
  result.ndcX = round(ndcX);
  result.ndcY = round(ndcY);
  result.screenX = round((ndcX + 1) / 2);
  result.screenY = round((1 - ndcY) / 2);
  result.inFrame = Math.abs(ndcX) <= 1 && Math.abs(ndcY) <= 1;
  result.edgeMargin = round(Math.min(1 - Math.abs(ndcX), 1 - Math.abs(ndcY)));
  const occluder = findOccluder(sample.location, subjectPoint, depth, occluders, sample.frame);
  if (occluder) {
    result.occluded = true;
    result.occluder = occluder;
  }
  return result;
}

// Coarse occlusion: does another object's bounding sphere straddle the sightline
// nearer than the subject? This is an approximation for review triage, not a
// ray-traced visibility test.
function findOccluder(camera, subject, subjectDepth, occluders, frame) {
  const axis = sub(subject, camera);
  const lengthSquared = dot(axis, axis);
  if (lengthSquared < 1e-9) return null;
  for (const occluder of occluders) {
    const index = Math.min(occluder.track.length - 1, Math.max(0, frame - occluder.track[0].frame));
    const center = occluder.track[index].location;
    const t = clamp(dot(sub(center, camera), axis) / lengthSquared, 0, 1);
    if (t <= 0 || t >= 1) continue;
    const closest = add(camera, scale(axis, t));
    if (distance(center, closest) <= occluder.radius && t * Math.sqrt(lengthSquared) < subjectDepth) {
      return occluder.id;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Anomaly detection and summary
// ---------------------------------------------------------------------------

function detectAnomalies(frames, thresholds, subject) {
  const anomalies = [];
  for (const frame of frames) {
    pushAnomaly(anomalies, frame, "speed", frame.speed, thresholds.speed);
    pushAnomaly(anomalies, frame, "acceleration", frame.accelerationMagnitude, thresholds.acceleration);
    pushAnomaly(anomalies, frame, "jerk", frame.jerkMagnitude, thresholds.jerk);
    pushAnomaly(anomalies, frame, "angular-velocity", frame.angularVelocity, thresholds.angularVelocity);
    pushAnomaly(anomalies, frame, "horizon", frame.horizonTilt, thresholds.horizon);
    if (subject && frame.subject && !frame.subject.inFrame) {
      anomalies.push({ frame: frame.frame, time: frame.time, type: "subject-out-of-frame", value: frame.subject.edgeMargin, threshold: 0 });
    }
    if (subject && frame.subject && frame.subject.occluded) {
      anomalies.push({ frame: frame.frame, time: frame.time, type: "subject-occluded", value: 1, threshold: 0, occluder: frame.subject.occluder });
    }
  }
  return anomalies;
}

function pushAnomaly(anomalies, frame, type, value, threshold) {
  if (Number.isFinite(value) && Number.isFinite(threshold) && value > threshold) {
    anomalies.push({ frame: frame.frame, time: frame.time, type, value, threshold });
  }
}

function summarize(frames, anomalies, subject) {
  const summary = {
    speed: peak(frames, (f) => f.speed),
    acceleration: peak(frames, (f) => f.accelerationMagnitude),
    jerk: peak(frames, (f) => f.jerkMagnitude),
    angularVelocity: peak(frames, (f) => f.angularVelocity),
    horizon: peak(frames, (f) => f.horizonTilt),
    anomalyCount: anomalies.length,
  };
  if (subject) {
    const distances = frames.map((f) => f.subject?.distance).filter(Number.isFinite);
    summary.subjectDistance = {
      min: distances.length ? round(Math.min(...distances)) : null,
      max: distances.length ? round(Math.max(...distances)) : null,
    };
    summary.subjectOutOfFrameFrames = frames.filter((f) => f.subject && !f.subject.inFrame).map((f) => f.frame);
    summary.subjectOccludedFrames = frames.filter((f) => f.subject && f.subject.occluded).map((f) => f.frame);
  }
  return summary;
}

function peak(frames, pick) {
  let max = -Infinity;
  let peakFrame = frames.length ? frames[0].frame : null;
  for (const frame of frames) {
    const value = pick(frame);
    if (Number.isFinite(value) && value > max) {
      max = value;
      peakFrame = frame.frame;
    }
  }
  return { max: max === -Infinity ? 0 : round(max), peakFrame };
}

// ---------------------------------------------------------------------------
// Math helpers
// ---------------------------------------------------------------------------

// Backward finite difference with a copied leading sample so every entry has a
// defined value and the array length matches the frame count.
function derivative(series, dt) {
  const output = series.map(() => [0, 0, 0]);
  for (let index = 1; index < series.length; index += 1) {
    output[index] = scale(sub(series[index], series[index - 1]), 1 / dt);
  }
  if (series.length > 1) output[0] = [...output[1]];
  return output;
}

function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function scale(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function magnitude(a) { return Math.sqrt(dot(a, a)); }
function normalize(a) { const m = magnitude(a); return m < 1e-9 ? [0, 0, 0] : scale(a, 1 / m); }
function distance(a, b) { return magnitude(sub(a, b)); }

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

function clamp(value, low, high) { return value < low ? low : value > high ? high : value; }
function degToRad(deg) { return (deg * Math.PI) / 180; }
function radToDeg(rad) { return (rad * 180) / Math.PI; }
function numberOr(value, fallback) { return Number.isFinite(value) ? value : fallback; }
function round(value) { return Number.isFinite(value) ? Number(value.toFixed(4)) : null; }
function round3(vector) { return vector.map(round); }
