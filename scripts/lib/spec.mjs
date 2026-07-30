import path from "node:path";
import { canonicalJson, readJson, sha256 } from "./io.mjs";
import { bakeShotTracks, describeRig } from "./camera.mjs";
import { computeTelemetry } from "./telemetry.mjs";
import { EASING_TYPES } from "./easing.mjs";

const primitives = new Set(["cube", "sphere", "cylinder", "cone"]);
const materialPresets = new Set(["matte", "painted-metal", "brushed-metal", "glass", "liquid", "rubber", "fabric", "skin", "hazmat", "emissive", "desert", "dust"]);
const renderEngines = new Set(["workbench", "cycles"]);
const lightTypes = new Set(["area", "point", "sun", "spot"]);
const outputResolutions = new Set(["480p", "720p", "1080p", "4k"]);
const aspectRatios = new Set(["16:9", "9:16", "1:1", "4:3", "3:4", "21:9", "adaptive"]);
const transformSpaces = new Set(["world", "local"]);
const contactRelations = new Set(["rider-seat", "hand-prop", "wheel-ground", "foot-ground", "hand-rail", "grip-surface", "contact"]);
const supportedVersions = new Set([1, 2]);
const rootKeys = new Set(["$schema", "version", "id", "title", "intent", "duration", "fps", "resolution", "world", "objects", "compounds", "templates", "instances", "contacts", "camera", "seedance", "beats"]);
const cameraKeys = new Set(["lensMm", "sensorWidthMm", "fStop", "rig", "keyframes", "easing", "roll", "focus", "telemetry"]);
const easingChannels = new Set(["location", "rotation", "lens", "focus"]);
const rigTypes = new Set(["keyframed", "dolly", "crane", "orbit", "follow", "handheld"]);
const proceduralRigTypes = new Set(["dolly", "crane", "orbit", "follow", "handheld"]);
const telemetryThresholdKeys = new Set(["speed", "acceleration", "jerk", "angularVelocity", "horizon"]);
const easingTypes = new Set(EASING_TYPES);
const maximumBeats = 64;
const maximumPathPoints = 64;
const v2RootKeys = ["compounds", "templates", "instances", "contacts"];
const v2ObjectKeys = ["parentId", "transformSpace", "anchors"];
const objectKeys = new Set(["id", "primitive", "role", "dimensions", "color", "materialPreset", "bevel", "smooth", "parentId", "transformSpace", "anchors", "keyframes"]);
const partKeys = new Set(["id", "primitive", "role", "dimensions", "color", "materialPreset", "bevel", "smooth", "parentPart", "location", "rotation", "anchors"]);
const anchorKeys = new Set(["id", "position", "direction"]);
const compoundKeys = new Set(["id", "role", "parts", "anchors", "keyframes"]);
const templateKeys = new Set(["id", "role", "parts", "anchors"]);
const instanceKeys = new Set(["id", "template", "role", "keyframes"]);
const contactKeys = new Set(["id", "relation", "a", "b"]);
const contactPointKeys = new Set(["body", "anchor"]);
const maximumCoordinate = 10000;
const maximumRotation = 36000;
const maximumKeyframes = 256;
const maximumListItems = 32;
const maximumPixelFrames = 1_000_000_000;
const maximumCompounds = 16;
const maximumTemplates = 16;
const maximumInstances = 32;
const maximumParts = 32;
const maximumAnchors = 32;
const maximumContacts = 32;
const kebabCase = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function loadShotSpec(file) {
  const absolute = path.resolve(file);
  return { file: absolute, spec: readJson(absolute) };
}

export function validateShotSpec(spec) {
  const errors = [];
  const warnings = [];
  const fail = (location, message) => errors.push(`${location}: ${message}`);

  if (!plainObject(spec)) return { errors: ["root: expected an object."], warnings };
  rejectUnknown(spec, rootKeys, "root", fail);
  if (spec.$schema !== undefined) stringBetween(spec.$schema, 1, 500, "$schema", fail);
  if (!supportedVersions.has(spec.version)) fail("version", "must equal 1 or 2.");
  const v2 = spec.version === 2;
  if (!v2) {
    for (const key of v2RootKeys) {
      if (spec[key] !== undefined) fail(key, "requires version 2.");
    }
  }
  if (!kebabCase.test(spec.id || "")) fail("id", "must be a lowercase kebab-case identifier.");
  stringBetween(spec.title, 3, 160, "title", fail);
  stringBetween(spec.intent, 20, 2000, "intent", fail);
  integerRange(spec.duration, 4, 15, "duration", fail);
  integerRange(spec.fps, 12, 60, "fps", fail);

  if (!plainObject(spec.resolution)) {
    fail("resolution", "must be an object.");
  } else {
    rejectUnknown(spec.resolution, new Set(["width", "height"]), "resolution", fail);
    integerRange(spec.resolution.width, 256, 4096, "resolution.width", fail);
    integerRange(spec.resolution.height, 256, 4096, "resolution.height", fail);
    if (Number.isInteger(spec.resolution.width) && spec.resolution.width % 2 !== 0) fail("resolution.width", "must be even for H.264/yuv420p encoding.");
    if (Number.isInteger(spec.resolution.height) && spec.resolution.height % 2 !== 0) fail("resolution.height", "must be even for H.264/yuv420p encoding.");
    if (Number.isInteger(spec.resolution.width) && Number.isInteger(spec.resolution.height) && Number.isInteger(spec.duration) && Number.isInteger(spec.fps)
      && spec.resolution.width * spec.resolution.height * spec.duration * spec.fps > maximumPixelFrames) {
      fail("resolution", `exceeds the ${maximumPixelFrames.toLocaleString("en-US")} pixel-frame render budget; lower resolution, duration, or fps.`);
    }
  }

  validateWorld(spec.world, fail);
  // bodies: placed, animatable entities (objects, compounds, instances) sharing one id namespace.
  // templates: reusable, non-animated blueprints in a separate namespace.
  const bodies = new Map();
  const templates = new Map();
  validateObjects(spec.objects, spec.duration, spec.fps, fail, warnings, { v2, bodies });
  if (v2) {
    validateTemplates(spec.templates, fail, { templates });
    validateCompounds(spec.compounds, spec.duration, spec.fps, fail, warnings, { bodies });
    validateInstances(spec.instances, spec.duration, spec.fps, fail, warnings, { bodies, templates });
    validateContacts(spec.contacts, fail, { bodies });
  }
  validateCamera(spec.camera, spec.duration, spec.fps, fail, warnings, { objectIds: new Set(bodies.keys()) });
  validateBeats(spec.beats, spec.duration, fail, warnings);
  validateSeedance(spec.seedance, fail);
  validateAspectRatio(spec.resolution, spec.seedance?.aspectRatio, fail);
  return { errors, warnings };
}

function validateWorld(world, fail) {
  if (!plainObject(world)) return fail("world", "must be an object.");
  rejectUnknown(world, new Set(["background", "groundColor", "groundSize", "lighting", "render", "lights"]), "world", fail);
  color(world.background, "world.background", fail);
  color(world.groundColor, "world.groundColor", fail);
  vector(world.groundSize, 2, "world.groundSize", fail, (value) => value > 0 && value <= maximumCoordinate);
  stringBetween(world.lighting, 5, 1000, "world.lighting", fail);
  if (world.render !== undefined) {
    if (!plainObject(world.render)) {
      fail("world.render", "must be an object.");
    } else {
      rejectUnknown(world.render, new Set(["engine", "samples", "volumeDensity"]), "world.render", fail);
      if (!renderEngines.has(world.render.engine)) fail("world.render.engine", `must be one of ${[...renderEngines].join(", ")}.`);
      integerRange(world.render.samples, 1, 128, "world.render.samples", fail);
      if (world.render.volumeDensity !== undefined) numberRange(world.render.volumeDensity, 0, 0.05, "world.render.volumeDensity", fail);
    }
  }
  if (world.lights !== undefined) validateLights(world.lights, fail);
}

function validateLights(lights, fail) {
  if (!Array.isArray(lights) || lights.length > 16) return fail("world.lights", "must contain at most 16 lights.");
  const ids = new Set();
  lights.forEach((light, index) => {
    const at = `world.lights[${index}]`;
    if (!plainObject(light)) return fail(at, "must be an object.");
    rejectUnknown(light, new Set(["id", "type", "color", "energy", "location", "rotation", "size", "spotSize"]), at, fail);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(light.id || "")) fail(`${at}.id`, "must be lowercase kebab-case.");
    if (ids.has(light.id)) fail(`${at}.id`, `duplicates "${light.id}".`);
    ids.add(light.id);
    if (!lightTypes.has(light.type)) fail(`${at}.type`, `must be one of ${[...lightTypes].join(", ")}.`);
    color(light.color, `${at}.color`, fail);
    numberRange(light.energy, 0, 100000, `${at}.energy`, fail);
    position(light.location, `${at}.location`, fail);
    vector(light.rotation, 3, `${at}.rotation`, fail, (value) => Math.abs(value) <= maximumRotation);
    if (light.size !== undefined) numberRange(light.size, Number.EPSILON, 1000, `${at}.size`, fail);
    if (light.spotSize !== undefined) numberRange(light.spotSize, 1, 179, `${at}.spotSize`, fail);
  });
}

function validateObjects(objects, duration, fps, fail, warnings, context) {
  const { v2, bodies } = context;
  if (!Array.isArray(objects) || objects.length === 0 || objects.length > 64) {
    fail("objects", "must contain between 1 and 64 objects.");
    return;
  }
  const parentById = new Map();
  const objectIds = new Set();
  objects.forEach((object, index) => {
    const at = `objects[${index}]`;
    if (!plainObject(object)) return fail(at, "must be an object.");
    rejectUnknown(object, objectKeys, at, fail);
    if (!kebabCase.test(object.id || "")) fail(`${at}.id`, "must be lowercase kebab-case.");
    if (registerBody(bodies, object.id, "object", at, fail)) objectIds.add(object.id);
    if (!primitives.has(object.primitive)) fail(`${at}.primitive`, `must be one of ${[...primitives].join(", ")}.`);
    stringBetween(object.role, 5, 500, `${at}.role`, fail);
    vector(object.dimensions, 3, `${at}.dimensions`, fail, (value) => value > 0 && value <= maximumCoordinate);
    color(object.color, `${at}.color`, fail);
    if (object.materialPreset !== undefined && !materialPresets.has(object.materialPreset)) fail(`${at}.materialPreset`, `must be one of ${[...materialPresets].join(", ")}.`);
    if (object.bevel !== undefined) numberRange(object.bevel, 0, 1, `${at}.bevel`, fail);
    if (object.smooth !== undefined && typeof object.smooth !== "boolean") fail(`${at}.smooth`, "must be a boolean.");
    for (const key of v2ObjectKeys) {
      if (!v2 && object[key] !== undefined) fail(`${at}.${key}`, "requires version 2.");
    }
    if (v2) validateObjectHierarchyFields(object, at, parentById, fail);
    if (v2) {
      const anchorIds = validateAnchors(object.anchors, `${at}.anchors`, fail);
      const body = bodies.get(object.id);
      if (body) body.anchors = anchorIds;
    }
    validateKeyframes(object.keyframes, duration, fps, `${at}.keyframes`, fail, warnings, object.role);
  });
  if (v2) validateParentReferences(objects, parentById, objectIds, fail);
}

function validateObjectHierarchyFields(object, at, parentById, fail) {
  if (object.transformSpace !== undefined && !transformSpaces.has(object.transformSpace)) {
    fail(`${at}.transformSpace`, `must be one of ${[...transformSpaces].join(", ")}.`);
  }
  const hasParent = object.parentId !== undefined;
  if (hasParent && !kebabCase.test(object.parentId || "")) fail(`${at}.parentId`, "must be lowercase kebab-case.");
  // parentId and transformSpace: local are coupled so previs coordinates are unambiguous.
  if (object.transformSpace === "local" && !hasParent) {
    fail(`${at}.transformSpace`, "\"local\" requires a parentId; local coordinates are only meaningful relative to a parent.");
  }
  if (hasParent && object.transformSpace === "world") {
    fail(`${at}.parentId`, "a parented object must use transformSpace \"local\"; author its keyframes relative to the parent.");
  }
  if (hasParent && typeof object.id === "string") parentById.set(object.id, object.parentId);
}

function validateParentReferences(objects, parentById, objectIds, fail) {
  objects.forEach((object, index) => {
    if (!plainObject(object) || object.parentId === undefined) return;
    const at = `objects[${index}].parentId`;
    if (object.parentId === object.id) return fail(at, "must not reference the object itself.");
    if (!objectIds.has(object.parentId)) return fail(at, `references unknown object "${object.parentId}".`);
    const cycle = detectCycle(object.id, parentById);
    if (cycle) fail(at, `introduces a parent cycle: ${cycle.join(" -> ")}.`);
  });
}

function detectCycle(startId, parentById) {
  const path = [startId];
  const seen = new Set([startId]);
  let current = parentById.get(startId);
  while (current !== undefined) {
    path.push(current);
    if (seen.has(current)) return path;
    seen.add(current);
    current = parentById.get(current);
  }
  return null;
}

function registerBody(bodies, id, kind, at, fail) {
  if (typeof id !== "string" || !kebabCase.test(id)) return false;
  if (bodies.has(id)) {
    fail(`${at}.id`, `duplicates the id "${id}" already used by a ${bodies.get(id).kind}.`);
    return false;
  }
  bodies.set(id, { kind, anchors: new Set() });
  return true;
}

function validateAnchors(anchors, at, fail) {
  const ids = new Set();
  if (anchors === undefined) return ids;
  if (!Array.isArray(anchors) || anchors.length > maximumAnchors) {
    fail(at, `must be an array of at most ${maximumAnchors} anchors.`);
    return ids;
  }
  anchors.forEach((anchor, index) => {
    const point = `${at}[${index}]`;
    if (!plainObject(anchor)) return fail(point, "must be an object.");
    rejectUnknown(anchor, anchorKeys, point, fail);
    if (!kebabCase.test(anchor.id || "")) fail(`${point}.id`, "must be lowercase kebab-case.");
    else if (ids.has(anchor.id)) fail(`${point}.id`, `duplicates anchor "${anchor.id}".`);
    else ids.add(anchor.id);
    position(anchor.position, `${point}.position`, fail);
    if (anchor.direction !== undefined) {
      vector(anchor.direction, 3, `${point}.direction`, fail, (value) => Math.abs(value) <= 1);
      if (validVector(anchor.direction, 3) && anchor.direction.every((value) => value === 0)) {
        fail(`${point}.direction`, "must not be a zero vector.");
      }
    }
  });
  return ids;
}

function validateParts(parts, at, fail, anchorIds) {
  if (!Array.isArray(parts) || parts.length === 0 || parts.length > maximumParts) {
    fail(at, `must contain between 1 and ${maximumParts} parts.`);
    return;
  }
  const partIds = new Set();
  const parentByPart = new Map();
  parts.forEach((part, index) => {
    const point = `${at}[${index}]`;
    if (!plainObject(part)) return fail(point, "must be an object.");
    rejectUnknown(part, partKeys, point, fail);
    if (!kebabCase.test(part.id || "")) fail(`${point}.id`, "must be lowercase kebab-case.");
    else if (partIds.has(part.id)) fail(`${point}.id`, `duplicates part "${part.id}".`);
    else partIds.add(part.id);
    if (!primitives.has(part.primitive)) fail(`${point}.primitive`, `must be one of ${[...primitives].join(", ")}.`);
    if (part.role !== undefined) stringBetween(part.role, 5, 500, `${point}.role`, fail);
    vector(part.dimensions, 3, `${point}.dimensions`, fail, (value) => value > 0 && value <= maximumCoordinate);
    color(part.color, `${point}.color`, fail);
    if (part.materialPreset !== undefined && !materialPresets.has(part.materialPreset)) fail(`${point}.materialPreset`, `must be one of ${[...materialPresets].join(", ")}.`);
    if (part.bevel !== undefined) numberRange(part.bevel, 0, 1, `${point}.bevel`, fail);
    if (part.smooth !== undefined && typeof part.smooth !== "boolean") fail(`${point}.smooth`, "must be a boolean.");
    position(part.location, `${point}.location`, fail);
    if (part.rotation !== undefined) vector(part.rotation, 3, `${point}.rotation`, fail, (value) => Math.abs(value) <= maximumRotation);
    if (part.parentPart !== undefined) {
      if (!kebabCase.test(part.parentPart)) fail(`${point}.parentPart`, "must be lowercase kebab-case.");
      if (typeof part.id === "string") parentByPart.set(part.id, part.parentPart);
    }
    const partAnchors = validateAnchors(part.anchors, `${point}.anchors`, fail);
    for (const id of partAnchors) {
      if (anchorIds.has(id)) fail(`${point}.anchors`, `anchor "${id}" duplicates another anchor in the same body.`);
      else anchorIds.add(id);
    }
  });
  parts.forEach((part, index) => {
    if (!plainObject(part) || part.parentPart === undefined) return;
    const point = `${at}[${index}].parentPart`;
    if (part.parentPart === part.id) return fail(point, "must not reference the part itself.");
    if (!partIds.has(part.parentPart)) return fail(point, `references unknown part "${part.parentPart}".`);
    const cycle = detectCycle(part.id, parentByPart);
    if (cycle) fail(point, `introduces a part cycle: ${cycle.join(" -> ")}.`);
  });
}

function validateCompounds(compounds, duration, fps, fail, warnings, { bodies }) {
  if (compounds === undefined) return;
  if (!Array.isArray(compounds) || compounds.length > maximumCompounds) {
    fail("compounds", `must be an array of at most ${maximumCompounds} compound proxies.`);
    return;
  }
  compounds.forEach((compound, index) => {
    const at = `compounds[${index}]`;
    if (!plainObject(compound)) return fail(at, "must be an object.");
    rejectUnknown(compound, compoundKeys, at, fail);
    if (!kebabCase.test(compound.id || "")) fail(`${at}.id`, "must be lowercase kebab-case.");
    const registered = registerBody(bodies, compound.id, "compound", at, fail);
    stringBetween(compound.role, 5, 500, `${at}.role`, fail);
    const anchorIds = validateAnchors(compound.anchors, `${at}.anchors`, fail);
    validateParts(compound.parts, `${at}.parts`, fail, anchorIds);
    validateKeyframes(compound.keyframes, duration, fps, `${at}.keyframes`, fail, warnings, compound.role);
    if (registered) bodies.get(compound.id).anchors = anchorIds;
  });
}

function validateTemplates(templatesSpec, fail, { templates }) {
  if (templatesSpec === undefined) return;
  if (!Array.isArray(templatesSpec) || templatesSpec.length > maximumTemplates) {
    fail("templates", `must be an array of at most ${maximumTemplates} templates.`);
    return;
  }
  templatesSpec.forEach((template, index) => {
    const at = `templates[${index}]`;
    if (!plainObject(template)) return fail(at, "must be an object.");
    rejectUnknown(template, templateKeys, at, fail);
    const validId = kebabCase.test(template.id || "");
    if (!validId) fail(`${at}.id`, "must be lowercase kebab-case.");
    else if (templates.has(template.id)) fail(`${at}.id`, `duplicates template "${template.id}".`);
    stringBetween(template.role, 5, 500, `${at}.role`, fail);
    const anchorIds = validateAnchors(template.anchors, `${at}.anchors`, fail);
    validateParts(template.parts, `${at}.parts`, fail, anchorIds);
    if (validId && !templates.has(template.id)) templates.set(template.id, { anchors: anchorIds });
  });
}

function validateInstances(instances, duration, fps, fail, warnings, { bodies, templates }) {
  if (instances === undefined) return;
  if (!Array.isArray(instances) || instances.length > maximumInstances) {
    fail("instances", `must be an array of at most ${maximumInstances} instances.`);
    return;
  }
  instances.forEach((instance, index) => {
    const at = `instances[${index}]`;
    if (!plainObject(instance)) return fail(at, "must be an object.");
    rejectUnknown(instance, instanceKeys, at, fail);
    if (!kebabCase.test(instance.id || "")) fail(`${at}.id`, "must be lowercase kebab-case.");
    const registered = registerBody(bodies, instance.id, "instance", at, fail);
    if (instance.role !== undefined) stringBetween(instance.role, 5, 500, `${at}.role`, fail);
    if (!kebabCase.test(instance.template || "")) {
      fail(`${at}.template`, "must be lowercase kebab-case.");
    } else if (!templates.has(instance.template)) {
      fail(`${at}.template`, `references unknown template "${instance.template}"; declare it under templates.`);
    } else if (registered) {
      bodies.get(instance.id).anchors = new Set(templates.get(instance.template).anchors);
    }
    validateKeyframes(instance.keyframes, duration, fps, `${at}.keyframes`, fail, warnings, instance.role || instance.template);
  });
}

function validateContacts(contacts, fail, { bodies }) {
  if (contacts === undefined) return;
  if (!Array.isArray(contacts) || contacts.length > maximumContacts) {
    fail("contacts", `must be an array of at most ${maximumContacts} contact relations.`);
    return;
  }
  const ids = new Set();
  contacts.forEach((contact, index) => {
    const at = `contacts[${index}]`;
    if (!plainObject(contact)) return fail(at, "must be an object.");
    rejectUnknown(contact, contactKeys, at, fail);
    if (contact.id !== undefined) {
      if (!kebabCase.test(contact.id)) fail(`${at}.id`, "must be lowercase kebab-case.");
      else if (ids.has(contact.id)) fail(`${at}.id`, `duplicates contact "${contact.id}".`);
      else ids.add(contact.id);
    }
    if (!contactRelations.has(contact.relation)) fail(`${at}.relation`, `must be one of ${[...contactRelations].join(", ")}.`);
    validateContactPoint(contact.a, `${at}.a`, bodies, fail);
    validateContactPoint(contact.b, `${at}.b`, bodies, fail);
    if (plainObject(contact.a) && plainObject(contact.b)
      && contact.a.body !== undefined && contact.a.body === contact.b.body && contact.a.anchor === contact.b.anchor) {
      fail(at, "must connect two distinct contact points.");
    }
  });
}

function validateContactPoint(pointSpec, at, bodies, fail) {
  if (!plainObject(pointSpec)) return fail(at, "must be an object.");
  rejectUnknown(pointSpec, contactPointKeys, at, fail);
  const validBody = kebabCase.test(pointSpec.body || "");
  const validAnchor = kebabCase.test(pointSpec.anchor || "");
  if (!validBody) fail(`${at}.body`, "must be lowercase kebab-case.");
  if (!validAnchor) fail(`${at}.anchor`, "must be lowercase kebab-case.");
  if (!validBody) return;
  const body = bodies.get(pointSpec.body);
  if (!body) return fail(`${at}.body`, `references unknown body "${pointSpec.body}".`);
  if (validAnchor && !body.anchors.has(pointSpec.anchor)) {
    fail(`${at}.anchor`, `references unknown anchor "${pointSpec.anchor}" on body "${pointSpec.body}".`);
  }
}

function validateKeyframes(keyframes, duration, fps, at, fail, warnings, role) {
  if (!Array.isArray(keyframes) || keyframes.length === 0 || keyframes.length > maximumKeyframes) return fail(at, `must contain between 1 and ${maximumKeyframes} keyframes.`);
  let previous = -Infinity;
  let previousFrame = -Infinity;
  keyframes.forEach((keyframe, index) => {
    const point = `${at}[${index}]`;
    if (!plainObject(keyframe)) return fail(point, "must be an object.");
    rejectUnknown(keyframe, new Set(["time", "location", "rotation", "easing"]), point, fail);
    numberRange(keyframe.time, 0, duration, `${point}.time`, fail);
    if (keyframe.easing !== undefined) validateEasingSpec(keyframe.easing, `${point}.easing`, fail);
    if (Number.isFinite(keyframe.time) && keyframe.time <= previous) fail(`${point}.time`, "must be strictly increasing.");
    if (validTimeline(duration, fps, keyframe.time)) {
      const frame = frameAt(keyframe.time, duration, fps);
      if (frame <= previousFrame) fail(`${point}.time`, `maps to frame ${frame}, which is not after the previous keyframe at ${fps} fps.`);
      previousFrame = frame;
    }
    previous = keyframe.time;
    position(keyframe.location, `${point}.location`, fail);
    if (keyframe.rotation !== undefined) vector(keyframe.rotation, 3, `${point}.rotation`, fail, (value) => Math.abs(value) <= maximumRotation);
  });
  for (let index = 1; index < keyframes.length; index += 1) {
    const before = keyframes[index - 1];
    const after = keyframes[index];
    if (!plainObject(before) || !plainObject(after)) continue;
    if (!validVector(before.location, 3) || !validVector(after.location, 3)) continue;
    const seconds = after.time - before.time;
    if (seconds <= 0) continue;
    const speed = distance(before.location, after.location) / seconds;
    if (speed > 12) warnings.push(`${at}: "${role}" reaches ${speed.toFixed(1)} m/s; confirm this is intentional.`);
    if (validVector(before.rotation, 3) && validVector(after.rotation, 3)) {
      const largestRotationStep = Math.max(...after.rotation.map((value, axis) => Math.abs(value - before.rotation[axis])));
      if (largestRotationStep > 180) {
        warnings.push(`${at}: "${role}" changes rotation by ${largestRotationStep.toFixed(1)} degrees between keys; Blender uses authored, unwrapped Euler values, so use values such as 350 -> 370 when a short forward turn is intended.`);
      }
    }
  }
}

function validateCamera(camera, duration, fps, fail, warnings, context = {}) {
  if (!plainObject(camera)) return fail("camera", "must be an object.");
  rejectUnknown(camera, cameraKeys, "camera", fail);
  numberRange(camera.lensMm, 12, 300, "camera.lensMm", fail);
  numberRange(camera.sensorWidthMm, 8, 70, "camera.sensorWidthMm", fail);
  if (camera.fStop !== undefined) numberRange(camera.fStop, 0.7, 32, "camera.fStop", fail);

  // The rig is either the legacy operator note (a string, always keyframed) or a
  // structured object whose "type" selects the procedural motion model.
  const structured = plainObject(camera.rig);
  if (structured) {
    validateCameraRig(camera.rig, duration, fps, "camera.rig", fail, warnings, context);
  } else {
    stringBetween(camera.rig, 3, 500, "camera.rig", fail);
  }
  if (camera.easing !== undefined) validateEasingMap(camera.easing, "camera.easing", fail);
  if (camera.roll !== undefined) validateScalarChannel(camera.roll, -maximumRotation, maximumRotation, "camera.roll", fail);
  if (camera.focus !== undefined) validateScalarChannel(camera.focus, 0, maximumCoordinate, "camera.focus", fail);
  if (camera.telemetry !== undefined) validateTelemetry(camera.telemetry, "camera.telemetry", fail, context);

  // Keyframes are required for a keyframed rig (the default) and for a handheld
  // rig whose base is keyframed; a self-contained procedural rig needs none.
  const rigType = structured ? camera.rig.type : "keyframed";
  const handheldKeyframedBase = rigType === "handheld" && !plainObject(camera.rig?.base);
  const keyframesRequired = rigType === "keyframed" || handheldKeyframedBase;
  if (camera.keyframes === undefined && !keyframesRequired) return;
  validateCameraKeyframes(camera.keyframes, duration, fps, "camera.keyframes", fail, warnings);
}

function validateCameraKeyframes(keyframes, duration, fps, at, fail, warnings) {
  if (!Array.isArray(keyframes) || keyframes.length < 2 || keyframes.length > maximumKeyframes) {
    fail(at, `must contain between 2 and ${maximumKeyframes} keyframes.`);
    return;
  }
  let previous = -Infinity;
  let previousFrame = -Infinity;
  keyframes.forEach((keyframe, index) => {
    const point = `${at}[${index}]`;
    if (!plainObject(keyframe)) return fail(point, "must be an object.");
    rejectUnknown(keyframe, new Set(["time", "location", "target", "lensMm"]), point, fail);
    numberRange(keyframe.time, 0, duration, `${point}.time`, fail);
    if (Number.isFinite(keyframe.time) && keyframe.time <= previous) fail(`${point}.time`, "must be strictly increasing.");
    if (validTimeline(duration, fps, keyframe.time)) {
      const frame = frameAt(keyframe.time, duration, fps);
      if (frame <= previousFrame) fail(`${point}.time`, `maps to frame ${frame}, which is not after the previous keyframe at ${fps} fps.`);
      previousFrame = frame;
    }
    previous = keyframe.time;
    position(keyframe.location, `${point}.location`, fail);
    position(keyframe.target, `${point}.target`, fail);
    if (validVector(keyframe.location, 3) && validVector(keyframe.target, 3) && distance(keyframe.location, keyframe.target) < 0.001) {
      fail(`${point}.target`, "must be at least 0.001 scene units from the camera location.");
    }
    if (keyframe.lensMm !== undefined) numberRange(keyframe.lensMm, 12, 300, `${point}.lensMm`, fail);
  });
  const first = keyframes[0]?.time;
  const last = keyframes.at(-1)?.time;
  if (first !== 0) warnings.push("camera.keyframes: first camera keyframe should start at 0 seconds.");
  if (last !== duration) warnings.push(`camera.keyframes: last camera keyframe should end at ${duration} seconds.`);
}

// A structured rig. Keys shared by every rig (easing, progress, lens, roll,
// focus, aim) are validated first, then the type-specific geometry.
function validateCameraRig(rig, duration, fps, at, fail, warnings, context) {
  if (!rigTypes.has(rig.type)) {
    return fail(`${at}.type`, `must be one of ${[...rigTypes].join(", ")}.`);
  }
  const allowed = new Set(["type", "easing", "progress", "lens", "roll", "focus", "aim"]);
  const perType = {
    dolly: ["path"],
    crane: ["path"],
    orbit: ["center", "radius", "azimuth", "elevation", "height"],
    follow: ["target", "offset", "lookOffset", "damping"],
    handheld: ["base", "seed", "frequency", "amplitude"],
  };
  for (const key of perType[rig.type] || []) allowed.add(key);
  rejectUnknown(rig, allowed, at, fail);
  if (rig.easing !== undefined) validateEasingMap(rig.easing, `${at}.easing`, fail);
  if (rig.progress !== undefined) validateEasingSpec(rig.progress, `${at}.progress`, fail);
  if (rig.lens !== undefined) validateScalarChannel(rig.lens, 12, 300, `${at}.lens`, fail);
  if (rig.roll !== undefined) validateScalarChannel(rig.roll, -maximumRotation, maximumRotation, `${at}.roll`, fail);
  if (rig.focus !== undefined) validateScalarChannel(rig.focus, 0, maximumCoordinate, `${at}.focus`, fail);
  if (rig.aim !== undefined) validateAim(rig.aim, `${at}.aim`, fail, context);

  if (rig.type === "dolly" || rig.type === "crane") {
    validatePath(rig.path, `${at}.path`, fail);
  } else if (rig.type === "orbit") {
    position(rig.center, `${at}.center`, fail);
    numberRange(rig.radius, Number.EPSILON, maximumCoordinate, `${at}.radius`, fail);
    if (rig.azimuth !== undefined) validateAngleChannel(rig.azimuth, `${at}.azimuth`, fail);
    if (rig.elevation !== undefined) validateAngleChannel(rig.elevation, `${at}.elevation`, fail);
    if (rig.height !== undefined) numberRange(rig.height, -maximumCoordinate, maximumCoordinate, `${at}.height`, fail);
  } else if (rig.type === "follow") {
    validateBodyReference(rig.target, `${at}.target`, fail, context);
    if (rig.offset !== undefined) position(rig.offset, `${at}.offset`, fail);
    if (rig.lookOffset !== undefined) position(rig.lookOffset, `${at}.lookOffset`, fail);
    if (rig.damping !== undefined) numberRange(rig.damping, 0, 0.99, `${at}.damping`, fail);
  } else if (rig.type === "handheld") {
    if (rig.seed !== undefined) integerRange(rig.seed, 0, 2147483647, `${at}.seed`, fail);
    if (rig.frequency !== undefined) numberRange(rig.frequency, 0.05, 30, `${at}.frequency`, fail);
    if (rig.amplitude !== undefined) validateHandheldAmplitude(rig.amplitude, `${at}.amplitude`, fail);
    if (rig.base !== undefined) {
      if (!plainObject(rig.base)) fail(`${at}.base`, "must be a rig object.");
      else if (rig.base.type === "handheld") fail(`${at}.base.type`, "must not be another handheld rig.");
      else validateCameraRig(rig.base, duration, fps, `${at}.base`, fail, warnings, context);
    }
  }
}

function validatePath(path, at, fail) {
  if (!Array.isArray(path) || path.length < 2 || path.length > maximumPathPoints) {
    return fail(at, `must contain between 2 and ${maximumPathPoints} points.`);
  }
  path.forEach((point, index) => position(point, `${at}[${index}]`, fail));
}

function validateAim(aim, at, fail, context) {
  if (Array.isArray(aim)) return position(aim, at, fail);
  if (!plainObject(aim)) return fail(at, "must be a position or an aim object.");
  const modes = new Set(["point", "path", "object", "lead"]);
  if (!modes.has(aim.mode)) return fail(`${at}.mode`, `must be one of ${[...modes].join(", ")}.`);
  if (aim.mode === "point") position(aim.point, `${at}.point`, fail);
  if (aim.mode === "path") validatePath(aim.path, `${at}.path`, fail);
  if (aim.mode === "object") {
    validateBodyReference(aim.id, `${at}.id`, fail, context);
    if (aim.offset !== undefined) position(aim.offset, `${at}.offset`, fail);
  }
  if (aim.mode === "lead") numberRange(aim.distance, Number.EPSILON, maximumCoordinate, `${at}.distance`, fail);
}

function validateBodyReference(id, at, fail, context) {
  if (!kebabCase.test(id || "")) return fail(at, "must be a lowercase kebab-case body id.");
  if (context?.objectIds && !context.objectIds.has(id)) fail(at, `references unknown object "${id}".`);
}

function validateEasingMap(map, at, fail) {
  if (!plainObject(map)) return fail(at, "must be an object of per-channel easings.");
  rejectUnknown(map, easingChannels, at, fail);
  for (const channel of easingChannels) {
    if (map[channel] !== undefined) validateEasingSpec(map[channel], `${at}.${channel}`, fail);
  }
}

function validateEasingSpec(spec, at, fail) {
  const type = typeof spec === "string" ? spec : plainObject(spec) ? spec.type : undefined;
  if (!easingTypes.has(type)) return fail(at, `must name one of ${[...easingTypes].join(", ")}.`);
  if (plainObject(spec)) {
    rejectUnknown(spec, new Set(["type", "handles"]), at, fail);
    if (spec.type === "BEZIER") {
      if (!Array.isArray(spec.handles) || spec.handles.length !== 4 || !spec.handles.every(Number.isFinite)) {
        fail(`${at}.handles`, "must be four numbers [x1, y1, x2, y2] for a BEZIER easing.");
      } else if (spec.handles[0] < 0 || spec.handles[0] > 1 || spec.handles[2] < 0 || spec.handles[2] > 1) {
        fail(`${at}.handles`, "x handles must lie in [0, 1] for a well-defined time mapping.");
      }
    }
  }
}

// A scalar channel is either a constant number or a { from, to } ramp.
function validateScalarChannel(spec, minimum, maximum, at, fail) {
  if (typeof spec === "number") return numberRange(spec, minimum, maximum, at, fail);
  if (!plainObject(spec)) return fail(at, "must be a number or a { from, to } ramp.");
  rejectUnknown(spec, new Set(["from", "to"]), at, fail);
  if (spec.from !== undefined) numberRange(spec.from, minimum, maximum, `${at}.from`, fail);
  if (spec.to !== undefined) numberRange(spec.to, minimum, maximum, `${at}.to`, fail);
  if (spec.from === undefined && spec.to === undefined) fail(at, "must set at least one of from or to.");
}

function validateAngleChannel(spec, at, fail) {
  validateScalarChannel(spec, -maximumRotation, maximumRotation, at, fail);
}

function validateHandheldAmplitude(amplitude, at, fail) {
  if (!plainObject(amplitude)) return fail(at, "must be an object of amplitudes.");
  rejectUnknown(amplitude, new Set(["position", "roll", "rotation"]), at, fail);
  if (amplitude.position !== undefined) numberRange(amplitude.position, 0, 10, `${at}.position`, fail);
  if (amplitude.roll !== undefined) numberRange(amplitude.roll, 0, 45, `${at}.roll`, fail);
  if (amplitude.rotation !== undefined) numberRange(amplitude.rotation, 0, 45, `${at}.rotation`, fail);
}

function validateTelemetry(telemetry, at, fail, context) {
  if (!plainObject(telemetry)) return fail(at, "must be an object.");
  rejectUnknown(telemetry, new Set(["subject", "thresholds"]), at, fail);
  if (telemetry.subject !== undefined) {
    const subject = telemetry.subject;
    if (!plainObject(subject)) fail(`${at}.subject`, "must be an object.");
    else {
      rejectUnknown(subject, new Set(["object", "point"]), `${at}.subject`, fail);
      if (subject.object !== undefined) validateBodyReference(subject.object, `${at}.subject.object`, fail, context);
      if (subject.point !== undefined) position(subject.point, `${at}.subject.point`, fail);
      if (subject.object === undefined && subject.point === undefined) {
        fail(`${at}.subject`, "must set either object or point.");
      }
    }
  }
  if (telemetry.thresholds !== undefined) {
    if (!plainObject(telemetry.thresholds)) fail(`${at}.thresholds`, "must be an object.");
    else {
      rejectUnknown(telemetry.thresholds, telemetryThresholdKeys, `${at}.thresholds`, fail);
      for (const key of telemetryThresholdKeys) {
        if (telemetry.thresholds[key] !== undefined) numberRange(telemetry.thresholds[key], 0, 1e6, `${at}.thresholds.${key}`, fail);
      }
    }
  }
}

function validateBeats(beats, duration, fail, warnings) {
  if (beats === undefined) return;
  if (!Array.isArray(beats) || beats.length === 0 || beats.length > maximumBeats) {
    return fail("beats", `must contain between 1 and ${maximumBeats} beats.`);
  }
  let previous = -Infinity;
  beats.forEach((beat, index) => {
    const at = `beats[${index}]`;
    if (!plainObject(beat)) return fail(at, "must be an object.");
    rejectUnknown(beat, new Set(["time", "label"]), at, fail);
    numberRange(beat.time, 0, duration, `${at}.time`, fail);
    if (Number.isFinite(beat.time) && beat.time <= previous) fail(`${at}.time`, "must be strictly increasing.");
    previous = beat.time;
    if (beat.label !== undefined) stringBetween(beat.label, 1, 120, `${at}.label`, fail);
  });
}

function validateSeedance(seedance, fail) {
  if (!plainObject(seedance)) return fail("seedance", "must be an object.");
  rejectUnknown(seedance, new Set(["model", "resolution", "aspectRatio", "generateAudio", "style", "continuity", "avoid", "seed"]), "seedance", fail);
  if (seedance.model !== "seedance-2.0") fail("seedance.model", "must equal seedance-2.0.");
  if (!outputResolutions.has(seedance.resolution)) fail("seedance.resolution", `must be one of ${[...outputResolutions].join(", ")}.`);
  if (!aspectRatios.has(seedance.aspectRatio)) fail("seedance.aspectRatio", `must be one of ${[...aspectRatios].join(", ")}.`);
  if (typeof seedance.generateAudio !== "boolean") fail("seedance.generateAudio", "must be a boolean.");
  stringBetween(seedance.style, 20, 2000, "seedance.style", fail);
  stringArray(seedance.continuity, 5, "seedance.continuity", fail);
  stringArray(seedance.avoid, 3, "seedance.avoid", fail);
  if (seedance.seed !== undefined) integerRange(seedance.seed, 0, 2147483647, "seedance.seed", fail);
}

export function compileShotSpec(spec) {
  const validation = validateShotSpec(spec);
  if (validation.errors.length) throw new Error(`Invalid shot spec:\n${validation.errors.map((error) => `- ${error}`).join("\n")}`);
  const frameEnd = spec.duration * spec.fps;
  const compileKeyframes = (keyframes) => {
    let rotation = [0, 0, 0];
    return keyframes.map((keyframe) => {
      rotation = keyframe.rotation ? [...keyframe.rotation] : rotation;
      return { ...keyframe, frame: frameAt(keyframe.time, spec.duration, spec.fps), rotation: [...rotation] };
    });
  };
  // Bake every rig and object to a per-frame track in JS: this single source of
  // truth feeds the renderer (LINEAR replay), telemetry, and the review pass so
  // all three agree exactly. Legacy string-rig + keyframes bakes with LINEAR
  // defaults, matching the previous globally-linear render.
  const bake = bakeShotTracks(spec);
  const telemetry = computeTelemetry({ camera: bake.camera, objects: bake.objects, spec });
  const trackById = new Map(bake.objects.map((entry) => [entry.id, entry.track]));
  const compiled = {
    version: 1,
    id: spec.id,
    title: spec.title,
    intent: spec.intent,
    timeline: { duration: spec.duration, fps: spec.fps, frameStart: 1, frameEnd },
    resolution: spec.resolution,
    world: spec.world,
    objects: spec.objects.map((object) => ({ ...object, keyframes: compileKeyframes(object.keyframes), track: trackById.get(object.id) })),
    // v2 previs entities are appended only when the source declares them, so v1 compiled output stays byte-identical.
    ...(spec.compounds === undefined ? {} : {
      compounds: spec.compounds.map((compound) => ({ ...compound, keyframes: compileKeyframes(compound.keyframes) })),
    }),
    ...(spec.templates === undefined ? {} : { templates: spec.templates }),
    ...(spec.instances === undefined ? {} : {
      instances: spec.instances.map((instance) => ({ ...instance, keyframes: compileKeyframes(instance.keyframes) })),
    }),
    ...(spec.contacts === undefined ? {} : { contacts: spec.contacts }),
    camera: {
      ...spec.camera,
      rigKind: bake.rig.type,
      track: bake.camera,
      // Legacy keyframed shots keep their mapped keyframe list; a self-contained
      // procedural rig carries only the baked track.
      ...(spec.camera.keyframes === undefined ? {} : {
        keyframes: spec.camera.keyframes.map((keyframe) => ({
          ...keyframe,
          frame: frameAt(keyframe.time, spec.duration, spec.fps),
          lensMm: keyframe.lensMm ?? spec.camera.lensMm,
        })),
      }),
    },
    ...(spec.beats === undefined ? {} : { beats: spec.beats }),
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
    telemetry,
    tracks: { camera: bake.camera, objects: bake.objects },
    beats: spec.beats ?? [],
    warnings: validation.warnings,
    hashes: { source: sourceHash, compiled: compiledHash, request: requestHash },
  };
}

export function compileSeedancePrompt(spec) {
  const describePath = (keyframes) => {
    let rotation = [0, 0, 0];
    return keyframes.map((keyframe) => {
      rotation = keyframe.rotation ?? rotation;
      return `${keyframe.time}s position [${keyframe.location.join(", ")}], rotation [${rotation.join(", ")}] degrees`;
    }).join(" -> ");
  };
  // Objects first keeps v1 blocking byte-identical; compound/instance clauses append only when present.
  const objectMovement = spec.objects.map((object) => `${object.role}: ${describePath(object.keyframes)}`);
  const compoundMovement = (spec.compounds ?? []).map((compound) => `${compound.role} (compound proxy moving as one rig): ${describePath(compound.keyframes)}`);
  const instanceMovement = (spec.instances ?? []).map((instance) => `${instance.role ?? instance.template} (instance of ${instance.template}): ${describePath(instance.keyframes)}`);
  const movement = [...objectMovement, ...compoundMovement, ...instanceMovement].join("; ");
  // Legacy keyframed rigs describe their authored keyframes verbatim (so existing
  // prompts stay byte-identical); a structured rig is summarised from its baked
  // track sampled at the shot ends and every beat.
  const structuredRig = plainObject(spec.camera.rig);
  const rigText = structuredRig ? describeRig(spec.camera.rig) : spec.camera.rig;
  const camera = spec.camera.keyframes
    ? spec.camera.keyframes.map((keyframe) => (
      `${keyframe.time}s position [${keyframe.location.join(", ")}], aim [${keyframe.target.join(", ")}], ${keyframe.lensMm ?? spec.camera.lensMm}mm lens`
    )).join("; ")
    : describeCameraTrack(spec);
  const contacts = (spec.contacts ?? []).map((contact) => (
    `${contact.relation}: ${contact.a.body} ${contact.a.anchor} stays in contact with ${contact.b.body} ${contact.b.anchor}`
  )).join("; ");
  return [
    spec.intent,
    `Visual direction: ${spec.seedance.style}`,
    `Lighting contract: ${spec.world.lighting}`,
    spec.world.render?.engine === "cycles"
      ? `Reference role: Video 1 is a cinematic Blender previs. Preserve its composition, spatial relationships, action order, action timing, camera path, lens rhythm, lighting contrast, and pacing while replacing simplified geometry with production-detail subjects and environment.`
      : `Reference role: Video 1 is a gray-box Blender previs. Use it only for composition, spatial relationships, action order, action timing, camera path, lens rhythm, and pacing. Replace every proxy shape, flat material, label, and gray-box surface with the described cinematic subjects and environment; never retain the primitive CGI appearance.`,
    `Blocking contract: ${movement}.`,
    contacts ? `Contact relations to preserve: ${contacts}.` : null,
    `Camera contract: ${rigText}, ${spec.camera.lensMm}mm base lens on a ${spec.camera.sensorWidthMm}mm sensor; ${camera}. Preserve screen direction and reveal timing rather than copying viewport shading.`,
    `Continuity locks: ${spec.seedance.continuity.join("; ")}.`,
    `Avoid: ${spec.seedance.avoid.join("; ")}.`,
    spec.seedance.generateAudio
      ? `Generate production audio that follows the visible actions and the ${spec.duration}-second beat structure; keep dialogue absent unless explicitly described.`
      : "Do not generate audio.",
  ].filter((line) => line !== null).join("\n\n");
}

// Summarise a structured rig's baked camera track for the Seedance prompt,
// sampling the shot ends and every beat frame so the contract still reads as a
// short position/aim/lens itinerary.
function describeCameraTrack(spec) {
  const { camera } = bakeShotTracks(spec);
  if (!camera.length) return "static camera";
  const frameOf = (time) => frameAt(time, spec.duration, spec.fps);
  const wanted = new Set([camera[0].frame, camera[camera.length - 1].frame]);
  for (const beat of spec.beats || []) wanted.add(frameOf(beat.time));
  const byFrame = new Map(camera.map((sample) => [sample.frame, sample]));
  const round2 = (value) => Number(value.toFixed(2));
  return [...wanted].sort((a, b) => a - b).map((frame) => byFrame.get(frame)).filter(Boolean).map((sample) => (
    `${sample.time}s position [${sample.location.map(round2).join(", ")}], aim [${sample.aim.map(round2).join(", ")}], ${round2(sample.lensMm)}mm lens`
  )).join("; ");
}

function plainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringBetween(value, minimum, maximum, at, fail) {
  const length = typeof value === "string" ? value.trim().length : -1;
  if (length < minimum || length > maximum) fail(at, `must be a string from ${minimum} to ${maximum} characters.`);
}

function stringArray(value, minimum, at, fail) {
  if (!Array.isArray(value) || value.length === 0 || value.length > maximumListItems || value.some((item) => typeof item !== "string" || item.trim().length < minimum || item.trim().length > 500)) {
    fail(at, `must contain 1 to ${maximumListItems} strings of ${minimum} to 500 characters.`);
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

function position(value, at, fail) {
  vector(value, 3, at, fail, (item) => Math.abs(item) <= maximumCoordinate);
}

function rejectUnknown(value, allowed, at, fail) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail(`${at}.${key}`, "is not an allowed property.");
  }
}

function validTimeline(duration, fps, time) {
  return Number.isInteger(duration) && Number.isInteger(fps) && Number.isFinite(time) && time >= 0 && time <= duration;
}

function frameAt(time, duration, fps) {
  return Math.min(duration * fps, 1 + Math.round(time * fps));
}

function validateAspectRatio(resolution, aspectRatio, fail) {
  if (!plainObject(resolution) || aspectRatio === "adaptive" || !/^\d+:\d+$/.test(aspectRatio || "")) return;
  const [left, right] = aspectRatio.split(":").map(Number);
  if (!Number.isFinite(resolution.width) || !Number.isFinite(resolution.height)) return;
  const expected = left / right;
  const actual = resolution.width / resolution.height;
  if (Math.abs(actual - expected) / expected > 0.02) {
    fail("seedance.aspectRatio", `does not match the ${resolution.width}x${resolution.height} previs; use a matching ratio or adaptive.`);
  }
}

function distance(left, right) {
  return Math.sqrt(left.reduce((sum, value, index) => sum + ((value - right[index]) ** 2), 0));
}
