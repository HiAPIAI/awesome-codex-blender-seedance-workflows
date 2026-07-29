import path from "node:path";
import { canonicalJson, readJson, sha256 } from "./io.mjs";

const primitives = new Set(["cube", "sphere", "cylinder", "cone"]);
const outputResolutions = new Set(["480p", "720p", "1080p", "4k"]);
const aspectRatios = new Set(["16:9", "9:16", "1:1", "4:3", "3:4", "21:9", "adaptive"]);

export function loadShotSpec(file) {
  const absolute = path.resolve(file);
  return { file: absolute, spec: readJson(absolute) };
}

export function validateShotSpec(spec) {
  const errors = [];
  const warnings = [];
  const fail = (location, message) => errors.push(`${location}: ${message}`);

  if (!plainObject(spec)) return { errors: ["root: expected an object."], warnings };
  if (spec.version !== 1) fail("version", "must equal 1.");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(spec.id || "")) fail("id", "must be a lowercase kebab-case identifier.");
  stringAtLeast(spec.title, 3, "title", fail);
  stringAtLeast(spec.intent, 20, "intent", fail);
  integerRange(spec.duration, 4, 15, "duration", fail);
  integerRange(spec.fps, 12, 60, "fps", fail);

  if (!plainObject(spec.resolution)) {
    fail("resolution", "must be an object.");
  } else {
    integerRange(spec.resolution.width, 256, 4096, "resolution.width", fail);
    integerRange(spec.resolution.height, 256, 4096, "resolution.height", fail);
  }

  validateWorld(spec.world, fail);
  validateObjects(spec.objects, spec.duration, fail, warnings);
  validateCamera(spec.camera, spec.duration, fail, warnings);
  validateSeedance(spec.seedance, fail);
  return { errors, warnings };
}

function validateWorld(world, fail) {
  if (!plainObject(world)) return fail("world", "must be an object.");
  color(world.background, "world.background", fail);
  color(world.groundColor, "world.groundColor", fail);
  vector(world.groundSize, 2, "world.groundSize", fail, (value) => value > 0);
  stringAtLeast(world.lighting, 5, "world.lighting", fail);
}

function validateObjects(objects, duration, fail, warnings) {
  if (!Array.isArray(objects) || objects.length === 0 || objects.length > 64) {
    fail("objects", "must contain between 1 and 64 objects.");
    return;
  }
  const ids = new Set();
  objects.forEach((object, index) => {
    const at = `objects[${index}]`;
    if (!plainObject(object)) return fail(at, "must be an object.");
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(object.id || "")) fail(`${at}.id`, "must be lowercase kebab-case.");
    if (ids.has(object.id)) fail(`${at}.id`, `duplicates "${object.id}".`);
    ids.add(object.id);
    if (!primitives.has(object.primitive)) fail(`${at}.primitive`, `must be one of ${[...primitives].join(", ")}.`);
    stringAtLeast(object.role, 5, `${at}.role`, fail);
    vector(object.dimensions, 3, `${at}.dimensions`, fail, (value) => value > 0);
    color(object.color, `${at}.color`, fail);
    validateKeyframes(object.keyframes, duration, `${at}.keyframes`, fail, warnings, object.role);
  });
}

function validateKeyframes(keyframes, duration, at, fail, warnings, role) {
  if (!Array.isArray(keyframes) || keyframes.length === 0) return fail(at, "must contain at least one keyframe.");
  let previous = -Infinity;
  keyframes.forEach((keyframe, index) => {
    const point = `${at}[${index}]`;
    if (!plainObject(keyframe)) return fail(point, "must be an object.");
    numberRange(keyframe.time, 0, duration, `${point}.time`, fail);
    if (Number.isFinite(keyframe.time) && keyframe.time <= previous) fail(`${point}.time`, "must be strictly increasing.");
    previous = keyframe.time;
    vector(keyframe.location, 3, `${point}.location`, fail);
    if (keyframe.rotation !== undefined) vector(keyframe.rotation, 3, `${point}.rotation`, fail);
  });
  for (let index = 1; index < keyframes.length; index += 1) {
    const before = keyframes[index - 1];
    const after = keyframes[index];
    if (!validVector(before.location, 3) || !validVector(after.location, 3)) continue;
    const seconds = after.time - before.time;
    if (seconds <= 0) continue;
    const speed = distance(before.location, after.location) / seconds;
    if (speed > 12) warnings.push(`${at}: "${role}" reaches ${speed.toFixed(1)} m/s; confirm this is intentional.`);
  }
}

function validateCamera(camera, duration, fail, warnings) {
  if (!plainObject(camera)) return fail("camera", "must be an object.");
  numberRange(camera.lensMm, 12, 300, "camera.lensMm", fail);
  numberRange(camera.sensorWidthMm, 8, 70, "camera.sensorWidthMm", fail);
  stringAtLeast(camera.rig, 3, "camera.rig", fail);
  if (!Array.isArray(camera.keyframes) || camera.keyframes.length < 2) {
    fail("camera.keyframes", "must contain at least two keyframes.");
    return;
  }
  let previous = -Infinity;
  camera.keyframes.forEach((keyframe, index) => {
    const at = `camera.keyframes[${index}]`;
    if (!plainObject(keyframe)) return fail(at, "must be an object.");
    numberRange(keyframe.time, 0, duration, `${at}.time`, fail);
    if (Number.isFinite(keyframe.time) && keyframe.time <= previous) fail(`${at}.time`, "must be strictly increasing.");
    previous = keyframe.time;
    vector(keyframe.location, 3, `${at}.location`, fail);
    vector(keyframe.target, 3, `${at}.target`, fail);
    if (keyframe.lensMm !== undefined) numberRange(keyframe.lensMm, 12, 300, `${at}.lensMm`, fail);
  });
  const first = camera.keyframes[0]?.time;
  const last = camera.keyframes.at(-1)?.time;
  if (first !== 0) warnings.push("camera.keyframes: first camera keyframe should start at 0 seconds.");
  if (last !== duration) warnings.push(`camera.keyframes: last camera keyframe should end at ${duration} seconds.`);
}

function validateSeedance(seedance, fail) {
  if (!plainObject(seedance)) return fail("seedance", "must be an object.");
  if (seedance.model !== "seedance-2.0") fail("seedance.model", "must equal seedance-2.0.");
  if (!outputResolutions.has(seedance.resolution)) fail("seedance.resolution", `must be one of ${[...outputResolutions].join(", ")}.`);
  if (!aspectRatios.has(seedance.aspectRatio)) fail("seedance.aspectRatio", `must be one of ${[...aspectRatios].join(", ")}.`);
  if (typeof seedance.generateAudio !== "boolean") fail("seedance.generateAudio", "must be a boolean.");
  stringAtLeast(seedance.style, 20, "seedance.style", fail);
  stringArray(seedance.continuity, "seedance.continuity", fail);
  stringArray(seedance.avoid, "seedance.avoid", fail);
  if (seedance.seed !== undefined) integerRange(seedance.seed, 0, 2147483647, "seedance.seed", fail);
}

export function compileShotSpec(spec) {
  const validation = validateShotSpec(spec);
  if (validation.errors.length) throw new Error(`Invalid shot spec:\n${validation.errors.map((error) => `- ${error}`).join("\n")}`);
  const frameEnd = spec.duration * spec.fps;
  const frameAt = (time) => Math.min(frameEnd, 1 + Math.round(time * spec.fps));
  const compiled = {
    version: 1,
    id: spec.id,
    title: spec.title,
    intent: spec.intent,
    timeline: { duration: spec.duration, fps: spec.fps, frameStart: 1, frameEnd },
    resolution: spec.resolution,
    world: spec.world,
    objects: spec.objects.map((object) => ({
      ...object,
      keyframes: object.keyframes.map((keyframe) => ({
        ...keyframe,
        frame: frameAt(keyframe.time),
        rotation: keyframe.rotation || [0, 0, 0],
      })),
    })),
    camera: {
      ...spec.camera,
      keyframes: spec.camera.keyframes.map((keyframe) => ({
        ...keyframe,
        frame: frameAt(keyframe.time),
        lensMm: keyframe.lensMm || spec.camera.lensMm,
      })),
    },
  };
  const prompt = compileSeedancePrompt(spec);
  const request = {
    model: spec.seedance.model,
    input: {
      prompt,
      reference_video_urls: ["{{PREVIS_VIDEO}}"],
      duration: spec.duration,
      resolution: spec.seedance.resolution,
      aspect_ratio: spec.seedance.aspectRatio,
      generate_audio: spec.seedance.generateAudio,
      ...(spec.seedance.seed === undefined ? {} : { seed: spec.seedance.seed }),
    },
  };
  const sourceHash = sha256(canonicalJson(spec));
  const compiledHash = sha256(canonicalJson(compiled));
  const requestHash = sha256(canonicalJson(request));
  return {
    compiled,
    prompt,
    request,
    warnings: validation.warnings,
    hashes: { source: sourceHash, compiled: compiledHash, request: requestHash },
  };
}

export function compileSeedancePrompt(spec) {
  const movement = spec.objects.map((object) => {
    const start = object.keyframes[0].location.join(", ");
    const end = object.keyframes.at(-1).location.join(", ");
    return `${object.role}: move from [${start}] to [${end}] across ${spec.duration}s`;
  }).join("; ");
  const camera = spec.camera.keyframes.map((keyframe) => (
    `${keyframe.time}s position [${keyframe.location.join(", ")}], aim [${keyframe.target.join(", ")}]`
  )).join("; ");
  return [
    spec.intent,
    `Visual direction: ${spec.seedance.style}`,
    `Reference role: Video 1 is a gray-box Blender previs. Use it only for composition, spatial relationships, action order, action timing, camera path, lens rhythm, and pacing. Replace every proxy shape, flat material, label, and gray-box surface with the described cinematic subjects and environment; never retain the primitive CGI appearance.`,
    `Blocking contract: ${movement}.`,
    `Camera contract: ${spec.camera.rig}, ${spec.camera.lensMm}mm base lens on a ${spec.camera.sensorWidthMm}mm sensor; ${camera}. Preserve screen direction and reveal timing rather than copying viewport shading.`,
    `Continuity locks: ${spec.seedance.continuity.join("; ")}.`,
    `Avoid: ${spec.seedance.avoid.join("; ")}.`,
    spec.seedance.generateAudio
      ? `Generate production audio that follows the visible actions and the ${spec.duration}-second beat structure; keep dialogue absent unless explicitly described.`
      : "Do not generate audio.",
  ].join("\n\n");
}

function plainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringAtLeast(value, minimum, at, fail) {
  if (typeof value !== "string" || value.trim().length < minimum) fail(at, `must be a string of at least ${minimum} characters.`);
}

function stringArray(value, at, fail) {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== "string" || item.trim().length < 3)) {
    fail(at, "must be a non-empty array of descriptive strings.");
  }
}

function integerRange(value, minimum, maximum, at, fail) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) fail(at, `must be an integer from ${minimum} to ${maximum}.`);
}

function numberRange(value, minimum, maximum, at, fail) {
  if (!Number.isFinite(value) || value < minimum || value > maximum) fail(at, `must be a number from ${minimum} to ${maximum}.`);
}

function vector(value, length, at, fail, predicate = () => true) {
  if (!validVector(value, length) || value.some((item) => !predicate(item))) fail(at, `must contain ${length} valid numbers.`);
}

function validVector(value, length) {
  return Array.isArray(value) && value.length === length && value.every(Number.isFinite);
}

function color(value, at, fail) {
  vector(value, 3, at, fail, (item) => item >= 0 && item <= 1);
}

function distance(left, right) {
  return Math.sqrt(left.reduce((sum, value, index) => sum + ((value - right[index]) ** 2), 0));
}
