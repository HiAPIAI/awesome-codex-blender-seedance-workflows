#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "./lib/args.mjs";
import { findBlender, findFfmpeg } from "./lib/blender.mjs";
import { writeJson, writeText } from "./lib/io.mjs";
import { compileShotSpec, loadShotSpec } from "./lib/spec.mjs";

const { options, positionals } = parseArgs(process.argv.slice(2), new Set(["dry-run", "scene-only"]));
if (positionals.length !== 1) {
  console.error("Usage: node scripts/render.mjs <shot.json> [--out-dir outputs/<id>] [--blender <path>] [--scene-only] [--dry-run]");
  process.exit(1);
}

try {
  const { spec } = loadShotSpec(positionals[0]);
  const result = compileShotSpec(spec);
  const output = path.resolve(options["out-dir"] || path.join("outputs", spec.id));
  fs.mkdirSync(output, { recursive: true });
  const compiledFile = path.join(output, "compiled.json");
  writeJson(compiledFile, result.compiled);
  writeJson(path.join(output, "seedance.request.json"), result.request);
  writeText(path.join(output, "prompt.txt"), `${result.prompt}\n`);
  writeJson(path.join(output, "manifest.json"), { version: 1, id: spec.id, hashes: result.hashes, warnings: result.warnings });

  const blender = findBlender(options.blender);
  const ffmpeg = findFfmpeg(options.ffmpeg);
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const renderer = path.join(root, "scripts", "blender", "render_previs.py");
  const blenderArgs = [
    "--background",
    "--factory-startup",
    "--python-exit-code", "1",
    "--python", renderer,
    "--",
    "--spec", compiledFile,
    "--out-dir", output,
    ...(options["scene-only"] ? [] : ["--render"]),
  ];
  if (options["dry-run"]) {
    console.log(JSON.stringify({ blender: blender || "<BLENDER_BIN>", args: blenderArgs, ffmpeg: ffmpeg || "<FFMPEG_BIN>", output }, null, 2));
  } else if (!blender) {
    throw new Error("Blender was not found. Install Blender 4.5 LTS, put blender on PATH, or pass --blender <absolute-path>.");
  } else if (!options["scene-only"] && !ffmpeg) {
    throw new Error("FFmpeg was not found. Install FFmpeg, set FFMPEG_BIN, or use --scene-only.");
  } else {
    const child = spawn(blender, blenderArgs, { stdio: "inherit", windowsHide: true });
    child.on("error", (error) => {
      console.error(`Failed to start Blender: ${error.message}`);
      process.exitCode = 1;
    });
    child.on("exit", async (code) => {
      if (code !== 0) {
        console.error(`Blender exited with code ${code}.`);
        process.exitCode = code || 1;
      } else {
        try {
          if (!options["scene-only"]) await encodeFrames(ffmpeg, output, spec.fps);
          console.log(`Rendered ${spec.id} to ${output}`);
        } catch (error) {
          console.error(error.message);
          process.exitCode = 1;
        }
      }
    });
  }
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

async function encodeFrames(ffmpeg, output, fps) {
  const pattern = path.join(output, "frames", "frame_%04d.png");
  const destination = path.join(output, "previs.mp4");
  const args = [
    "-y", "-framerate", String(fps), "-start_number", "1", "-i", pattern,
    "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p",
    "-movflags", "+faststart", destination,
  ];
  await new Promise((resolve, reject) => {
    const process = spawn(ffmpeg, args, { stdio: "inherit", windowsHide: true });
    process.on("error", reject);
    process.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`FFmpeg exited with code ${code}.`)));
  });
  if (!fs.existsSync(destination) || fs.statSync(destination).size === 0) throw new Error("FFmpeg completed without a usable previs.mp4.");
  const reportFile = path.join(output, "render-report.json");
  const report = JSON.parse(fs.readFileSync(reportFile, "utf8"));
  report.encoded = true;
  report.files = ["previs.blend", "previs.mp4"];
  writeJson(reportFile, report);
}
