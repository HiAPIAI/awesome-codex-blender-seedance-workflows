#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "./lib/args.mjs";
import { assertSafeBaseUrl, createTask, downloadOutput, extractOutputUrl, prepareRequest, waitForTask } from "./lib/hiapi.mjs";
import { readJson, writeJson } from "./lib/io.mjs";

const { options } = parseArgs(process.argv.slice(2), new Set(["no-wait"]));
const baseUrl = assertSafeBaseUrl(String(options["base-url"] || process.env.HIAPI_BASE_URL || "https://api.hiapi.ai"));
const outputDir = path.resolve(options["out-dir"] || "outputs/hiapi");

try {
  if (options.resume) {
    await resume(options.resume);
  } else {
    if (!options.request || !options.video) usage("--request and --video are required.");
    const prepared = prepareRequest(readJson(path.resolve(options.request)), path.resolve(options.video), {
      embedMedia: Boolean(options["confirm-preflight"]),
    });
    console.log(JSON.stringify({ ...prepared.summary, pricing: "https://www.hiapi.ai/en/pricing", preflightToken: prepared.preflightToken }, null, 2));
    if (!options["confirm-preflight"]) {
      console.log(`Dry run only. To create exactly this paid task, repeat the command with --confirm-preflight ${prepared.preflightToken}`);
    } else {
      if (options["confirm-preflight"] !== prepared.preflightToken) throw new Error("Preflight token mismatch. Run a fresh dry run after every request or video change.");
      const apiKey = requireApiKey();
      const { taskId, response } = await createTask(prepared.payload, { baseUrl, apiKey });
      fs.mkdirSync(outputDir, { recursive: true });
      writeJson(path.join(outputDir, `${taskId}.submitted.json`), { taskId, preflightToken: prepared.preflightToken, response });
      console.log(`Created HiAPI task ${taskId}.`);
      if (!options["no-wait"]) await finish(taskId, apiKey);
    }
  }
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

async function resume(taskId) {
  await finish(String(taskId).trim(), requireApiKey());
}

async function finish(taskId, apiKey) {
  const response = await waitForTask(taskId, {
    baseUrl,
    apiKey,
    pollIntervalMs: Number(options["poll-interval-ms"] || 5000),
    pollTimeoutMs: Number(options["poll-timeout-ms"] || 1200000),
  }, ({ status }) => console.log(`${taskId}: ${status}`));
  fs.mkdirSync(outputDir, { recursive: true });
  writeJson(path.join(outputDir, `${taskId}.result.json`), response);
  const url = extractOutputUrl(response);
  if (!url) throw new Error(`Task ${taskId} succeeded but no output video URL was returned.`);
  const destination = path.join(outputDir, `${taskId}.mp4`);
  await downloadOutput(url, destination);
  console.log(`Saved generated_unreviewed output to ${destination}. Human review is still required.`);
}

function requireApiKey() {
  if (!process.env.HIAPI_API_KEY) throw new Error("HIAPI_API_KEY is not configured in this process. Never paste the key into chat or command arguments.");
  return process.env.HIAPI_API_KEY;
}

function usage(message) {
  throw new Error(`${message}\nUsage:\n  node scripts/submit.mjs --request <seedance.request.json> --video <previs.mp4> [--confirm-preflight <token>]\n  node scripts/submit.mjs --resume <task-id> [--out-dir outputs/hiapi]`);
}
