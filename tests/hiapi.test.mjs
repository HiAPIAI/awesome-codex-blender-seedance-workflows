import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { assertSafeBaseUrl, createTask, extractOutputUrl, prepareRequest, waitForTask } from "../scripts/lib/hiapi.mjs";

const template = {
  model: "seedance-2.0",
  input: {
    prompt: "Keep the camera and blocking from Video 1, replacing all proxy geometry.",
    reference_video_urls: ["{{PREVIS_VIDEO}}"],
    duration: 5,
    resolution: "720p",
    aspect_ratio: "16:9",
    generate_audio: false
  }
};

test("preflight token binds both request and local video without logging base64", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "blender-seedance-test-"));
  try {
    const video = path.join(directory, "previs.mp4");
    fs.writeFileSync(video, Buffer.from("fake-mp4-one"));
    const first = prepareRequest(template, video, { embedMedia: true });
    const second = prepareRequest(template, video, { embedMedia: true });
    assert.equal(first.preflightToken, second.preflightToken);
    assert.match(first.payload.input.reference_video_urls[0], /^data:video\/mp4;base64,/);
    assert.doesNotMatch(JSON.stringify(first.summary), /base64/);
    fs.writeFileSync(video, Buffer.from("fake-mp4-two"));
    assert.notEqual(prepareRequest(template, video).preflightToken, first.preflightToken);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("task lifecycle submits once and polls to success", async (context) => {
  let posts = 0;
  let gets = 0;
  const server = http.createServer((request, response) => {
    response.setHeader("Content-Type", "application/json");
    if (request.method === "POST" && request.url === "/v1/tasks") {
      posts += 1;
      response.end(JSON.stringify({ data: { taskId: "task-test-1" } }));
      return;
    }
    if (request.method === "GET" && request.url === "/v1/tasks/task-test-1") {
      gets += 1;
      response.end(JSON.stringify(gets === 1
        ? { data: { status: "processing" } }
        : { data: { status: "success", output: { video_url: "https://example.test/result.mp4" } } }));
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ message: "not found" }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => server.close());
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const created = await createTask(template, { baseUrl, apiKey: "test-key" });
  const result = await waitForTask(created.taskId, { baseUrl, apiKey: "test-key", pollIntervalMs: 1, pollTimeoutMs: 1000 });
  assert.equal(posts, 1);
  assert.equal(gets, 2);
  assert.equal(extractOutputUrl(result), "https://example.test/result.mp4");
});

test("request placeholder is strict", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "blender-seedance-test-"));
  try {
    const video = path.join(directory, "previs.mp4");
    fs.writeFileSync(video, "x");
    const invalid = structuredClone(template);
    invalid.input.reference_video_urls = ["https://example.test/already-hosted.mp4"];
    assert.throws(() => prepareRequest(invalid, video), /exactly one/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("API keys can only be sent over HTTPS or localhost HTTP", () => {
  assert.equal(assertSafeBaseUrl("https://api.hiapi.ai/"), "https://api.hiapi.ai");
  assert.match(assertSafeBaseUrl("http://127.0.0.1:3000"), /^http:\/\/127\.0\.0\.1:3000/);
  assert.throws(() => assertSafeBaseUrl("http://api.example.test"), /must use HTTPS/);
});
