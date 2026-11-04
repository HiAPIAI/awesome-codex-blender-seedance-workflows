# Repository Guide For Codex

This repository turns a structured shot specification into a Blender previs and a reviewed Seedance request.

## Non-negotiable workflow

1. Start from an existing file under `examples/` or copy one into a new folder.
2. Change only `shot.json` until `npm run validate` passes.
3. Run `npm run compile -- <shot.json> --out-dir <dir>` and review `prompt.txt`, `manifest.json`, and `seedance.request.json`.
4. Run `npm run render -- <shot.json> --out-dir <dir>`. Inspect the entire previs before generation.
5. Run `npm run generate -- --request <seedance.request.json> --video <previs.mp4>` for a dry run.
6. A paid request requires the exact `--confirm-preflight <token>` printed by that dry run. Never invent or reuse a token after changing inputs.

## Safety and quality boundaries

- Never put API keys, signed URLs, local absolute paths, generated media, or `.blend` files in Git.
- Do not run arbitrary model-authored Python inside Blender. Extend the shot schema and the white-listed renderer instead.
- Treat gray-box geometry as motion, layout, timing, and camera guidance only. The final prompt must explicitly replace proxy appearance.
- Keep a shot between 4 and 15 seconds. Split longer scenes into separate shot specs.
- Do not claim a generated clip passed continuity or motion fidelity until a human reviewed the full output.
- Preserve attribution for researched projects in `docs/research.md`; do not copy their prose, media, or code without license review.

## Verification

Run `npm test` after every code or example change. When Blender is installed, also render `examples/warehouse-pursuit/shot.json` and verify `previs.mp4`, `previs.blend`, and `render-report.json`.
