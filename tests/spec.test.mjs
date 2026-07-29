import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { compileShotSpec, validateShotSpec } from "../scripts/lib/spec.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const warehouse = JSON.parse(fs.readFileSync(path.join(root, "examples", "warehouse-pursuit", "shot.json"), "utf8"));

test("all example shot specs validate", () => {
  const exampleRoot = path.join(root, "examples");
  for (const entry of fs.readdirSync(exampleRoot, { withFileTypes: true }).filter((item) => item.isDirectory())) {
    const spec = JSON.parse(fs.readFileSync(path.join(exampleRoot, entry.name, "shot.json"), "utf8"));
    assert.deepEqual(validateShotSpec(spec).errors, [], entry.name);
  }
});

test("compilation is deterministic and binds the previs placeholder", () => {
  const first = compileShotSpec(warehouse);
  const second = compileShotSpec(structuredClone(warehouse));
  assert.deepEqual(first.hashes, second.hashes);
  assert.equal(first.request.input.reference_video_urls[0], "{{PREVIS_VIDEO}}");
  assert.match(first.prompt, /Replace every proxy shape/);
  assert.equal(first.compiled.timeline.frameEnd, 144);
  assert.equal(first.compiled.camera.keyframes.at(-1).frame, 144);
});

test("invalid timing and duplicate ids fail before Blender", () => {
  const invalid = structuredClone(warehouse);
  invalid.duration = 16;
  invalid.objects[1].id = invalid.objects[0].id;
  invalid.objects[0].keyframes[1].time = 0;
  const result = validateShotSpec(invalid);
  assert.ok(result.errors.some((error) => error.startsWith("duration:")));
  assert.ok(result.errors.some((error) => error.includes("duplicates")));
  assert.ok(result.errors.some((error) => error.includes("strictly increasing")));
});

test("implausible proxy speeds produce a warning without blocking stunts", () => {
  const fast = structuredClone(warehouse);
  fast.objects[0].keyframes[1].location = [100, 0, 0.9];
  const result = validateShotSpec(fast);
  assert.equal(result.errors.length, 0);
  assert.ok(result.warnings.some((warning) => warning.includes("m/s")));
});
