# Architecture

## Contracts

`shot.json` is the source of truth. It describes intent, duration, render dimensions, proxy geometry, object keyframes, camera keyframes, and Seedance creative locks. The JSON schema documents the public format; `scripts/lib/spec.mjs` enforces the same critical rules without a runtime dependency.

The compiler creates four reviewable artifacts:

- `compiled.json`: frame-resolved Blender input.
- `prompt.txt`: natural-language visual, blocking, camera, continuity, and proxy-replacement contract.
- `seedance.request.json`: `/v1/tasks` payload with a single `{{PREVIS_VIDEO}}` placeholder.
- `manifest.json`: source, compiled, and request hashes plus warnings.

## Render path

Blender runs with `--background --factory-startup --python-exit-code 1`. The Python script creates only white-listed primitives and transform keyframes, saves `previs.blend`, and renders frame-stepped PNGs through Workbench. FFmpeg encodes those frames as H.264/yuv420p with faststart. Compiler output is byte-deterministic; render pixels can still vary across Blender builds, drivers, and hardware.

Separating frame rendering from video encoding avoids Blender-version differences in video output settings and ensures Python exceptions fail the parent command.

## Generation path

The submitter replaces `{{PREVIS_VIDEO}}` with a local data URI. Its dry-run summary replaces the base64 with filename, byte count, and SHA-256, so logs stay small and non-sensitive. The confirmation token hashes that summary and becomes invalid whenever the request or video changes.

`POST /v1/tasks` is executed once and is never automatically retried. Only idempotent task polling retries transient failures. A task can be resumed by ID without creating another paid request.

## Trust boundaries

| Input | Trust | Enforcement |
|---|---|---|
| Committed shot spec | Untrusted until validated | Schema rules, bounds, allowed primitives |
| Blender Python renderer | Trusted repository code | No dynamic `exec`, no model-authored script input |
| Local previs | User-reviewed artifact | SHA-256-bound preflight token |
| HiAPI response | Untrusted external data | HTTP/status checks, terminal-state handling |
| Generated video | Unreviewed output | Explicit `generated_unreviewed` handoff language |
