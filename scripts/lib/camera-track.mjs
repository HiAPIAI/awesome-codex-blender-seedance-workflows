import path from "node:path";
import { readJson } from "./io.mjs";

const coordinateConventions = new Set(["blender-right-handed-z-up"]);
const units = new Set(["meter"]);
const sourceKeys = new Set(["hash", "blendFile", "camera", "blenderVersion", "recordedAt"]);
const rootKeys = new Set(["$schema", "version", "coordinateConvention", "fps", "frameStart", "frameEnd", "unit", "source", "frames"]);
const frameKeys = new Set(["frame", "time", "matrix", "lensMm", "focusDistance", "fStop", "sensorWidthMm", "sensorShiftX", "sensorShiftY"]);
const hexHash = /^[a-f0-9]{64}$/;
const maximumFrames = 100000;
const matrixTolerance = 1e-4;

export function loadCameraTrack(file) {
  const absolute = path.resolve(file);
  return { file: absolute, track: readJson(absolute) };
}

export function validateCameraTrack(track) {
  const errors = [];
  const warnings = [];
  const fail = (location, message) => errors.push(`${location}: ${message}`);

  if (!plainObject(track)) return { errors: ["root: expected an object."], warnings };
  rejectUnknown(track, rootKeys, "root", fail);
  if (track.$schema !== undefined && (typeof track.$schema !== "string" || track.$schema.length < 1 || track.$schema.length > 500)) {
    fail("$schema", "must be a string from 1 to 500 characters.");
  }
  if (track.version !== 1) fail("version", "must equal 1.");
  if (!coordinateConventions.has(track.coordinateConvention)) {
    fail("coordinateConvention", `must be one of ${[...coordinateConventions].join(", ")}.`);
  }
  if (track.unit !== undefined && !units.has(track.unit)) fail("unit", `must be one of ${[...units].join(", ")}.`);
  if (!Number.isFinite(track.fps) || track.fps <= 0 || track.fps > 240) fail("fps", "must be a finite number in (0, 240].");

  const frameStartValid = Number.isInteger(track.frameStart) && track.frameStart >= 0 && track.frameStart <= 1000000;
  const frameEndValid = Number.isInteger(track.frameEnd) && track.frameEnd >= 0 && track.frameEnd <= 1000000;
  if (!frameStartValid) fail("frameStart", "must be an integer from 0 to 1000000.");
  if (!frameEndValid) fail("frameEnd", "must be an integer from 0 to 1000000.");
  if (frameStartValid && frameEndValid && track.frameEnd < track.frameStart) {
    fail("frameEnd", "must be greater than or equal to frameStart.");
  }

  validateSource(track.source, fail);
  validateFrames(track, frameStartValid, frameEndValid, fail, warnings);
  return { errors, warnings };
}

function validateSource(source, fail) {
  if (!plainObject(source)) return fail("source", "must be an object.");
  rejectUnknown(source, sourceKeys, "source", fail);
  if (typeof source.hash !== "string" || !hexHash.test(source.hash)) {
    fail("source.hash", "must be a 64-character lowercase hex SHA-256 digest.");
  }
  for (const key of ["blendFile", "camera", "blenderVersion", "recordedAt"]) {
    if (source[key] !== undefined && (typeof source[key] !== "string" || source[key].length < 1 || source[key].length > 1024)) {
      fail(`source.${key}`, "must be a non-empty string.");
    }
  }
}

function validateFrames(track, frameStartValid, frameEndValid, fail, warnings) {
  const { frames } = track;
  if (!Array.isArray(frames) || frames.length < 2 || frames.length > maximumFrames) {
    fail("frames", `must contain between 2 and ${maximumFrames} frames.`);
    return;
  }
  if (frameStartValid && frameEndValid) {
    const expected = track.frameEnd - track.frameStart + 1;
    if (frames.length !== expected) {
      fail("frames", `must contain exactly ${expected} contiguous frames for the ${track.frameStart}-${track.frameEnd} range; found ${frames.length}.`);
    }
  }
  let previousTime = -Infinity;
  frames.forEach((frame, index) => {
    const at = `frames[${index}]`;
    if (!plainObject(frame)) return fail(at, "must be an object.");
    rejectUnknown(frame, frameKeys, at, fail);
    if (!Number.isInteger(frame.frame)) {
      fail(`${at}.frame`, "must be an integer.");
    } else if (frameStartValid && frame.frame !== track.frameStart + index) {
      fail(`${at}.frame`, `must equal ${track.frameStart + index} so the sequence stays contiguous with no gaps or duplicates.`);
    }
    if (!Number.isFinite(frame.time) || frame.time < 0) {
      fail(`${at}.time`, "must be a finite number greater than or equal to 0.");
    } else {
      if (frame.time <= previousTime) fail(`${at}.time`, "must be strictly increasing.");
      previousTime = frame.time;
    }
    validateMatrix(frame.matrix, `${at}.matrix`, fail);
    if (!Number.isFinite(frame.lensMm) || frame.lensMm <= 0) fail(`${at}.lensMm`, "must be a finite number greater than 0.");
    if (!Number.isFinite(frame.sensorWidthMm) || frame.sensorWidthMm <= 0) fail(`${at}.sensorWidthMm`, "must be a finite number greater than 0.");
    finiteOptional(frame.focusDistance, 0, 1000000, `${at}.focusDistance`, fail);
    finiteOptional(frame.fStop, Number.EPSILON, 1000, `${at}.fStop`, fail);
    finiteOptional(frame.sensorShiftX, -10, 10, `${at}.sensorShiftX`, fail);
    finiteOptional(frame.sensorShiftY, -10, 10, `${at}.sensorShiftY`, fail);
  });
}

function validateMatrix(matrix, at, fail) {
  if (!Array.isArray(matrix) || matrix.length !== 16 || !matrix.every(Number.isFinite)) {
    fail(at, "must be 16 finite numbers (a row-major 4x4 world matrix).");
    return;
  }
  // Bottom row of an affine transform is [0, 0, 0, 1]; pins the row-major convention and rejects garbage matrices.
  const bottomRow = matrix.slice(12);
  const expected = [0, 0, 0, 1];
  if (bottomRow.some((value, index) => Math.abs(value - expected[index]) > matrixTolerance)) {
    fail(at, "bottom row must be [0, 0, 0, 1]; store the world matrix row-major with an affine bottom row.");
  }
}

function finiteOptional(value, minimum, maximum, at, fail) {
  if (value === undefined) return;
  if (!Number.isFinite(value) || value < minimum || value > maximum) fail(at, `must be a finite number from ${minimum} to ${maximum}.`);
}

function plainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function rejectUnknown(value, allowed, at, fail) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail(`${at}.${key}`, "is not an allowed property.");
  }
}
