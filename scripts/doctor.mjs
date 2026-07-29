#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { findBlender, blenderVersion, findFfmpeg } from "./lib/blender.mjs";
import { parseArgs } from "./lib/args.mjs";

const { options } = parseArgs(process.argv.slice(2), new Set(["json", "strict"]));
const blender = findBlender();
const ffmpeg = findFfmpeg();
const nodeMajor = Number(process.versions.node.split(".")[0]);
const git = spawnSync(process.platform === "win32" ? "where.exe" : "which", ["git"], { encoding: "utf8" });
const checks = {
  node: { ok: nodeMajor >= 20, value: `Node ${process.versions.node}` },
  git: { ok: git.status === 0, value: git.status === 0 ? "available" : "not found" },
  blender: { ok: Boolean(blender), value: blender ? blenderVersion(blender) : "not found; install Blender 4.5 LTS or set BLENDER_BIN" },
  ffmpeg: { ok: Boolean(ffmpeg), value: ffmpeg || "not found; install FFmpeg or set FFMPEG_BIN" },
  hiapiKey: { ok: Boolean(process.env.HIAPI_API_KEY), value: process.env.HIAPI_API_KEY ? "configured" : "not configured (only required for paid generation)" },
};
const readiness = {
  compile: checks.node.ok,
  render: checks.node.ok && checks.blender.ok && checks.ffmpeg.ok,
  paidGeneration: checks.node.ok && checks.hiapiKey.ok,
};
if (options.json) {
  console.log(JSON.stringify({ checks, readiness }, null, 2));
} else {
  for (const [name, check] of Object.entries(checks)) console.log(`${check.ok ? "PASS" : "MISS"} ${name}: ${check.value}`);
  console.log(`Ready: compile=${readiness.compile}, render=${readiness.render}, paidGeneration=${readiness.paidGeneration}`);
}
if (options.strict && Object.values(checks).some((check) => !check.ok)) process.exitCode = 1;
