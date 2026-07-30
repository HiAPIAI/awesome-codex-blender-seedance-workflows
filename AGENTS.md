# Repository Guide For Codex

This repository turns a natural-language shot brief into a structured Blender previs and a reviewed manual Seedance handoff.

## Non-negotiable workflow

1. Accept a natural-language brief or a reviewed 2D start frame. Lock art direction, first-frame composition, subject scale, horizon, and screen direction before opening Blender. Do not require the user to write JSON; preserve the brief in `intent` and author the structured spec yourself.
2. Start from the closest file under `examples/` and change only `shot.json` until `npm run validate` passes.
3. Establish the ground plane, subject footprint, and screen direction first. Model only the control signal, using the fewest primitive proxies that preserve silhouette, relative scale, contact, path, spacing, occlusion, and parallax. Default to six proxies or fewer.
4. Make the first camera keyframe match the approved frame brief: lens, camera height, horizon, target, subject size, overlap, and screen direction. Use one dominant camera move and two keys unless the brief contains a distinct beat; change blocking, timing, or camera one at a time.
5. Run `npm run compile -- <shot.json> --out-dir <dir>` and review `prompt.txt` and `manifest.json`.
6. Run `npm run render -- <shot.json> --out-dir <dir> --blocking-svg`. Watch the entire previs and inspect `motion-trace.json` when exact camera, lens, target, or proxy transforms matter.
7. Deliver `previs.mp4`, `prompt.txt`, and `seedance-handoff.md`. The user uploads the motion reference and generates the final rendered clip in Seedance 2.0.
8. Treat `npm run generate` as optional. Use it only after an explicit paid-submission request, a matching dry run, completed human review, and verification that the active provider forwards reference video inputs end to end.

## Safety and quality boundaries

- Never put API keys, signed URLs, local absolute paths, generated media, or `.blend` files in Git.
- Do not run arbitrary model-authored Python inside Blender. Extend the shot schema and the white-listed renderer instead.
- Treat gray-box geometry as motion, layout, timing, and camera guidance only. The final prompt must explicitly replace proxy appearance.
- Keep Workbench as the default. Use Cycles or extra materials/lights only when lighting, transparency, reflection, or depth cues change the shot decision.
- A 2D start frame is optional authoring evidence. Do not claim it, the previs, or the prompt was uploaded unless the selected Seedance surface actually received it.
- Keep a shot between 4 and 15 seconds. Split longer scenes into separate shot specs.
- Do not claim a generated clip passed continuity or motion fidelity until a human reviewed the full output.
- Preserve attribution for researched projects in `docs/research.md`; do not copy their prose, media, or code without license review.

## Verification

Run `npm test` after every code or example change. When Blender is installed, also render `examples/warehouse-pursuit/shot.json` and verify `previs.mp4`, `previs.blend`, `motion-trace.json`, `seedance-handoff.md`, `handoff-manifest.json`, and `render-report.json`.
