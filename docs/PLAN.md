# Development Plan

## Product position

Provide the smallest trustworthy bridge between Codex, Blender previs, and Seedance generation. The repository should be useful without a custom GUI and complementary to Blender MCP and Blockout rather than a clone of either.

## P0 - executable foundation (completed)

- [x] Versioned shot schema with camera, proxy, world, and Seedance constraints.
- [x] Three original workflows covering action, reveal, and product cinematography.
- [x] Deterministic compiler producing a prompt, API request, manifest, and hashes.
- [x] Blender 4.5+/5.x batch renderer with strict Python failure propagation.
- [x] PNG-frame to H.264 encoding through FFmpeg.
- [x] HiAPI `/v1/tasks` submit, poll, resume, and output download lifecycle.
- [x] Dry-run-first paid gate bound to the request and local video SHA-256.
- [x] Node 20/22 CI, unit tests, bilingual docs, contribution and security guidance.

## P1 - stronger review artifacts

- Generate first/middle/last stills and a contact sheet.
- Add automatic frame non-blank and camera-cut detection.
- Add optional top-down blocking diagrams.
- Add a compact human QC report beside each render.

## P2 - authoring adapters

- Import a constrained subset of Blockout metadata into `shot.json`.
- Add a Blender MCP handoff prompt that exports only schema-approved state.
- Add GLB/FBX proxy import after a license and sandbox boundary review.

## P3 - community scale

- Build a generated workflow index from canonical JSON.
- Add public, rights-cleared before/after showcases.
- Add multilingual workflow pages only after the English and Chinese source stay synchronized automatically.

## Success criteria

- A new contributor can render an example in under ten minutes after dependencies are installed.
- A changed request or video cannot reuse an old paid confirmation token.
- Every merged workflow is reproducible from committed text files.
- No secret, signed media URL, local absolute path, generated video, or third-party unlicensed asset enters Git.
