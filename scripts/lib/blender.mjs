import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

export function findBlender(explicit = process.env.BLENDER_BIN) {
  const candidates = [];
  if (explicit) candidates.push(path.resolve(explicit));
  const command = process.platform === "win32" ? "where.exe" : "which";
  const lookup = spawnSync(command, [process.platform === "win32" ? "blender.exe" : "blender"], { encoding: "utf8" });
  if (lookup.status === 0) candidates.push(...lookup.stdout.split(/\r?\n/).filter(Boolean));
  if (process.platform === "win32") {
    const roots = [
      path.join(process.env.ProgramFiles || "C:\\Program Files", "Blender Foundation"),
      path.join(process.env.LOCALAPPDATA || "", "Programs", "Blender Foundation"),
    ];
    for (const root of roots) {
      if (!root || !fs.existsSync(root)) continue;
      for (const entry of fs.readdirSync(root, { withFileTypes: true }).filter((item) => item.isDirectory()).sort().reverse()) {
        candidates.push(path.join(root, entry.name, "blender.exe"));
      }
      candidates.push(path.join(root, "blender.exe"));
    }
  }
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

export function blenderVersion(executable) {
  if (!executable) return null;
  const result = spawnSync(executable, ["--version"], { encoding: "utf8", timeout: 15000 });
  if (result.status !== 0) return null;
  return result.stdout.split(/\r?\n/)[0]?.trim() || null;
}

export function findFfmpeg(explicit = process.env.FFMPEG_BIN) {
  const candidates = [];
  if (explicit) candidates.push(path.resolve(explicit));
  const command = process.platform === "win32" ? "where.exe" : "which";
  const lookup = spawnSync(command, [process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg"], { encoding: "utf8" });
  if (lookup.status === 0) candidates.push(...lookup.stdout.split(/\r?\n/).filter(Boolean));
  if (process.platform === "win32") {
    const packageRoot = path.join(process.env.LOCALAPPDATA || "", "Microsoft", "WinGet", "Packages");
    if (fs.existsSync(packageRoot)) {
      for (const entry of fs.readdirSync(packageRoot, { withFileTypes: true }).filter((item) => item.isDirectory() && /ffmpeg/i.test(item.name))) {
        collectNamed(path.join(packageRoot, entry.name), "ffmpeg.exe", candidates, 4);
      }
    }
  }
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function collectNamed(directory, name, output, depth) {
  if (depth < 0) return;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isFile() && entry.name.toLowerCase() === name) output.push(target);
    else if (entry.isDirectory()) collectNamed(target, name, output, depth - 1);
  }
}
