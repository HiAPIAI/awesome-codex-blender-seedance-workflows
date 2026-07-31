# TODO

## 2026-07-31 - Granite cliff Seedance 2.0 generation

- Generated the reviewed 10-second Blender previs through HiAPI Seedance 2.0 as task `tk-hiapi-01KYV4GTDQPDGKR8ZRRXCTF1H8` using the user-approved Chinese reference-video prompt.
- Removed the unsupported `seed` request field after a definitive pre-submit HTTP 400; the corrected 1080p, 16:9, audio-enabled request then completed successfully without a duplicate task.
- Downloaded and verified the generated 1920x1080 H.264/AAC output: 24 fps, 10.054 seconds, full decode pass, SHA-256 `d168cdcfe57e4fa3e861aca16a45244a0acf171cea53356e9f9a76c70a206974`; final temporal fidelity remains subject to full human playback review.

## 2026-07-31 - Granite cliff survival previs

- Added a 10-second high-altitude climbing survival shot with a four-beat action timeline, animated 24-50mm camera path, Cycles lighting, falling-rock proxies, and a Seedance 2.0 handoff prompt.
- Fixed Blender 5.2 depth-of-field keyframing so spec-track renders can publish successfully.
- Verified with `npm test`, schema/runtime validation, a 240-frame Blender render, H.264/FFprobe checks, automatic review, and a non-paying Seedance preflight.
