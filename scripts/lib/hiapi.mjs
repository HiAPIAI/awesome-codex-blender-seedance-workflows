import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { canonicalJson, sha256, sha256File } from "./io.mjs";

const successStatuses = new Set(["success", "completed"]);
const failureStatuses = new Set(["fail", "failed", "error", "canceled", "cancelled"]);
const retryable = new Set([408, 425, 429, 500, 502, 503, 504]);
const maxMediaBytes = 180 * 1024 * 1024;

export function prepareRequest(template, videoFile, options = {}) {
  const absolute = path.resolve(videoFile);
  const stat = fs.statSync(absolute);
  if (!stat.isFile()) throw new Error(`Reference video is not a file: ${absolute}`);
  if (stat.size > maxMediaBytes) throw new Error("Reference video exceeds 180 MiB. Compress it or provide a hosted URL in a custom request.");
  const extension = path.extname(absolute).toLowerCase();
  const mime = extension === ".webm" ? "video/webm" : extension === ".mov" ? "video/quicktime" : "video/mp4";
  const payload = structuredClone(template);
  validateGenerationRequest(payload);
  if (!payload?.input || !Array.isArray(payload.input.reference_video_urls)) {
    throw new Error("Request must contain input.reference_video_urls.");
  }
  const placeholders = payload.input.reference_video_urls.filter((value) => value === "{{PREVIS_VIDEO}}").length;
  if (placeholders !== 1 || payload.input.reference_video_urls.length !== 1) {
    throw new Error("Request must contain exactly one {{PREVIS_VIDEO}} reference placeholder.");
  }
  const media = { name: path.basename(absolute), bytes: stat.size, sha256: sha256File(absolute), mime };
  payload.input.reference_video_urls = options.embedMedia
    ? [`data:${mime};base64,${fs.readFileSync(absolute).toString("base64")}`]
    : ["{{PREVIS_VIDEO}}"];
  const summaryPayload = structuredClone(payload);
  summaryPayload.input.reference_video_urls = [`local://${media.name}#sha256=${media.sha256}&bytes=${media.bytes}`];
  const summary = { endpoint: "/v1/tasks", method: "POST", media, payload: summaryPayload };
  const preflightToken = sha256(canonicalJson(summary));
  return { payload, summary, preflightToken };
}

export async function createTask(payload, config) {
  assertSafeBaseUrl(config.baseUrl);
  const response = await requestJson(`${config.baseUrl}/v1/tasks`, {
    method: "POST",
    headers: authHeaders(config.apiKey),
    body: JSON.stringify(payload),
    timeoutMs: config.timeoutMs || 60000,
  });
  const taskId = extractTaskId(response);
  if (!taskId) throw new Error("HiAPI accepted the request but did not return a task id.");
  return { taskId, response };
}

export async function getTask(taskId, config) {
  assertSafeBaseUrl(config.baseUrl);
  return requestJson(`${config.baseUrl}/v1/tasks/${encodeURIComponent(taskId)}`, {
    method: "GET",
    headers: authHeaders(config.apiKey),
    timeoutMs: config.timeoutMs || 60000,
    retries: config.retries ?? 3,
  });
}

export async function waitForTask(taskId, config, onUpdate = () => {}) {
  const intervalMs = config.pollIntervalMs ?? 5000;
  const deadline = Date.now() + (config.pollTimeoutMs ?? 20 * 60 * 1000);
  while (Date.now() < deadline) {
    const response = await getTask(taskId, config);
    const status = extractStatus(response);
    onUpdate({ taskId, status, response });
    if (successStatuses.has(status)) return response;
    if (failureStatuses.has(status)) throw new Error(`HiAPI task ${taskId} ended with status ${status}.`);
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Timed out waiting for HiAPI task ${taskId}. Resume later with --resume ${taskId}.`);
}

export async function downloadOutput(url, destination) {
  const response = await fetch(url);
  if (!response.ok || !response.body) throw new Error(`Unable to download output: HTTP ${response.status}.`);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(destination));
  return destination;
}

export function extractTaskId(response) {
  return response?.data?.taskId || response?.data?.task_id || response?.taskId || response?.task_id || response?.data?.id || null;
}

export function extractStatus(response) {
  return String(response?.data?.status || response?.status || "pending").toLowerCase();
}

export function extractOutputUrl(response) {
  const data = response?.data || response;
  const candidates = [
    data?.output?.video_url,
    data?.output?.videoUrl,
    data?.output_url,
    data?.video_url,
    data?.url,
    data?.outputs?.[0]?.url,
    data?.output?.[0]?.url,
  ];
  return candidates.find((value) => typeof value === "string" && /^https?:\/\//i.test(value)) || null;
}

async function requestJson(url, options) {
  const retries = options.retries || 0;
  for (let attempt = 0; ; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs || 60000);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal, timeoutMs: undefined, retries: undefined });
      const text = await response.text();
      let body;
      try {
        body = text ? JSON.parse(text) : {};
      } catch {
        body = { message: text.slice(0, 500) };
      }
      if (response.ok) return body;
      if (attempt < retries && retryable.has(response.status)) {
        await new Promise((resolve) => setTimeout(resolve, 500 * (2 ** attempt)));
        continue;
      }
      const message = body?.message || body?.error?.message || `HTTP ${response.status}`;
      throw new Error(`HiAPI request failed (${response.status}): ${message}`);
    } catch (error) {
      if (attempt < retries && (error.name === "AbortError" || error instanceof TypeError)) {
        await new Promise((resolve) => setTimeout(resolve, 500 * (2 ** attempt)));
        continue;
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}

function authHeaders(apiKey) {
  return { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };
}

export function assertSafeBaseUrl(value) {
  const url = new URL(value);
  const local = new Set(["localhost", "127.0.0.1", "::1"]).has(url.hostname);
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
    throw new Error("HIAPI_BASE_URL must use HTTPS. Plain HTTP is allowed only for localhost tests.");
  }
  return url.toString().replace(/\/$/, "");
}

function validateGenerationRequest(payload) {
  const input = payload?.input;
  if (payload?.model !== "seedance-2.0") throw new Error("Request model must be seedance-2.0.");
  if (!input || typeof input.prompt !== "string" || input.prompt.trim().length < 20) throw new Error("Request input.prompt is missing or too short.");
  if (!Number.isInteger(input.duration) || input.duration < 4 || input.duration > 15) throw new Error("Request input.duration must be an integer from 4 to 15.");
  if (!["480p", "720p", "1080p", "4k"].includes(input.resolution)) throw new Error("Request input.resolution is invalid.");
  if (!["16:9", "9:16", "1:1", "4:3", "3:4", "21:9", "adaptive"].includes(input.aspect_ratio)) throw new Error("Request input.aspect_ratio is invalid.");
  if (input.first_frame_url || input.last_frame_url) throw new Error("Previs reference mode cannot be mixed with first_frame_url or last_frame_url.");
}
