#!/usr/bin/env node
import path from "node:path";
import { parseArgs } from "./lib/args.mjs";
import { relativePortable, writeJson, writeText } from "./lib/io.mjs";
import { compileShotSpec, loadShotSpec } from "./lib/spec.mjs";

const { options, positionals } = parseArgs(process.argv.slice(2), new Set(["check"]));
if (positionals.length !== 1) {
  console.error("Usage: node scripts/compile.mjs <shot.json> [--out-dir build/<id>] [--check]");
  process.exit(1);
}

try {
  const { file, spec } = loadShotSpec(positionals[0]);
  const result = compileShotSpec(spec);
  if (options.check) {
    console.log(`PASS ${spec.id}: source ${result.hashes.source.slice(0, 12)}, request ${result.hashes.request.slice(0, 12)}`);
    result.warnings.forEach((warning) => console.warn(`WARN ${warning}`));
  } else {
    const output = path.resolve(options["out-dir"] || path.join("build", spec.id));
    writeJson(path.join(output, "compiled.json"), result.compiled);
    writeJson(path.join(output, "seedance.request.json"), result.request);
    writeText(path.join(output, "prompt.txt"), `${result.prompt}\n`);
    writeJson(path.join(output, "manifest.json"), {
      version: 1,
      id: spec.id,
      source: relativePortable(process.cwd(), file),
      files: ["compiled.json", "prompt.txt", "seedance.request.json"],
      hashes: result.hashes,
      warnings: result.warnings,
    });
    console.log(`Compiled ${spec.id} to ${output}`);
  }
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
