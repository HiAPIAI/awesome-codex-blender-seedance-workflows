# Repository Guide For Codex

This repository turns a structured shot specification into a Blender previs and a reviewed Seedance request.

## Non-negotiable workflow

1. Begin with one reviewed 2D start frame or a precise frame brief. Lock the intended art direction, first-frame composition, subject scale, horizon, and screen direction before opening Blender. Do not commit the image unless its rights are cleared.
2. Start from the closest file under `examples/` and change only `shot.json` until `npm run validate` passes.
3. Model only the control signal. Use the fewest primitive proxies that preserve silhouette, relative scale, ground contact, path, spacing, and important occlusion. Add detail only when it changes silhouette, contact, occlusion, reflection/refraction, or shot readability. Skip final topology, faces, fingers, micro-texture, hidden surfaces, and decoration.
4. Make the first camera keyframe match the approved 2D frame: lens, camera height, horizon, target, subject size, overlap, and screen direction. Add only the keyframes needed for distinct action or camera beats; change blocking, timing, or camera one at a time.
5. Run `npm run compile -- <shot.json> --out-dir <dir>` and review `prompt.txt`, `manifest.json`, and `seedance.request.json`.
6. Run `npm run render -- <shot.json> --out-dir <dir>`. Watch the entire previs and inspect `motion-trace.json` when exact camera, lens, target, or proxy transforms matter.
7. Run `npm run generate -- --request <seedance.request.json> --video <previs.mp4>` for a dry run.
8. A paid request requires the exact `--confirm-preflight <token>` printed by that dry run. Never invent or reuse a token after changing inputs.

## Safety and quality boundaries

- Never put API keys, signed URLs, local absolute paths, generated media, or `.blend` files in Git.
- Do not run arbitrary model-authored Python inside Blender. Extend the shot schema and the white-listed renderer instead.
- Treat gray-box geometry as motion, layout, timing, and camera guidance only. The final prompt must explicitly replace proxy appearance.
- Keep Workbench as the default. Use Cycles or extra materials/lights only when lighting, transparency, reflection, or depth cues change the shot decision.
- The 2D start frame is currently an authoring reference; this CLI submits the previs video, not the start image. Do not claim both were uploaded.
- Keep a shot between 4 and 15 seconds. Split longer scenes into separate shot specs.
- Do not claim a generated clip passed continuity or motion fidelity until a human reviewed the full output.
- Preserve attribution for researched projects in `docs/research.md`; do not copy their prose, media, or code without license review.

## Verification

Run `npm test` after every code or example change. When Blender is installed, also render `examples/warehouse-pursuit/shot.json` and verify `previs.mp4`, `previs.blend`, `motion-trace.json`, and `render-report.json`.
