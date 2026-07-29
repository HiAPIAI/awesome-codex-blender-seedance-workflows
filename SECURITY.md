# Security Policy

## Report privately

Use the repository's GitHub private vulnerability reporting feature. Do not open a public issue for API-key exposure, command execution, path traversal, unsafe Blender scripting, or paid-task duplication.

## Supported version

Security fixes target the latest `main` branch until tagged releases begin.

## Credential handling

The CLI reads `HIAPI_API_KEY` only from the process environment and never intentionally prints it. It does not automatically load `.env`. Generated requests, videos, Blender files, output metadata, and signed URLs are ignored by Git.

If a key enters Git history or a public log, revoke it immediately in the HiAPI dashboard before attempting history cleanup.

## Execution boundary

The Blender renderer consumes a validated schema with a white-list of primitive types and numeric transforms. Pull requests that add arbitrary `exec`, `eval`, shell interpolation, generated Python, or remote script loading will not be accepted.
