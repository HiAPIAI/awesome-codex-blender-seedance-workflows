---
name: awesome-codex-blender-seedance-workflows
description: Turn a natural-language shot brief into a minimal Blender previs, verified camera and blocking traces, and a complete manual Seedance 2.0 handoff bundle. Use when Codex needs to block a scene, rough-model only motion-relevant geometry, design or record a camera move, render a Blender motion reference, or prepare previs.mp4 plus prompt.txt for a user to generate the final clip in Seedance.
---

# Blender + Seedance Previs

Read `AGENTS.md` before acting. Treat manual Seedance handoff as the default result; API submission is a separate optional step.

## Author from natural language

1. Preserve the user's visual intent in `intent`, then translate the brief directly into a schema-valid `shot.json`. Do not invent a keyword parser or require the user to write JSON.
2. Start with the closest file under `examples/`. Change only the shot spec until `npm run validate -- <shot.json>` passes.
3. When the brief omits safe details, default to 4 seconds, 24 fps, 640x360, Workbench, one continuous shot, one camera move, and no generated audio.
4. Ask only when a missing choice would materially change the subject, action, camera direction, duration, or aspect ratio.

## Block plane first

1. Establish the ground plane, horizon, subject footprint, screen direction, and first-frame scale before adding depth.
2. Add only enough primitives to preserve silhouette, relative scale, ground contact, path, spacing, important occlusion, and readable parallax. Keep the first pass at six proxies or fewer unless the shot cannot be read.
3. Skip final topology, hidden surfaces, faces, fingers, micro-texture, and decoration. Add detail only when it changes silhouette, contact, occlusion, reflection/refraction, or the shot decision.

## Author the camera

Choose one dominant move: lateral slide, dolly in/out, short arc, or crane rise/fall. Use only the first and final camera keys unless the brief contains a distinct camera beat. Keep lens changes, target changes, and camera translation constant unless one of them is the purpose of the shot.

Match frame 1 before animating: camera height, horizon, target, lens, subject size, overlap, and screen direction. Change blocking, timing, or camera in separate iterations.

## Render and hand off

Run:

```powershell
npm run validate -- <shot.json>
npm run render -- <shot.json> --out-dir <output-dir> --blocking-svg
```

Watch the complete `previs.mp4`; inspect `review/contact-sheet.png`, `review-report.json`, and `motion-trace.json`. A successful render automatically writes:

- `previs.mp4`: primary Blender motion reference
- `prompt.txt`: Seedance appearance, blocking, camera, and continuity contract
- `review/first-frame.png`: optional composition reference
- `review/contact-sheet.png`: first/middle/last comparison
- `motion-trace.json`: evaluated camera and proxy transforms
- `seedance-handoff.md`: manual upload instructions
- `handoff-manifest.json`: parameters, hashes, and file roles

Give the user `previs.mp4`, `prompt.txt`, and the handoff guide. The user generates the final rendered clip in Seedance 2.0, then reviews it against the previs.

## API boundary

Do not run `npm run generate` by default. Use it only when the user explicitly requests paid API submission, reviews the exact dry run, and the active provider has been verified to forward reference-video inputs end to end. A declared schema field is not proof that an upstream adapter uses it.

Never describe gray-box geometry as the final look, claim Blender generated the final Seedance render, or claim camera fidelity before a human watches the full generated clip.
