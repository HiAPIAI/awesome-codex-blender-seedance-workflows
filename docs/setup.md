# Setup

## Requirements

- Node.js 20 or newer.
- Blender 4.5 or newer. Blender 5.2.0 LTS is verified.
- FFmpeg with `libx264`. FFmpeg 8.1.2 is verified.
- Git for contributing.
- `HIAPI_API_KEY` only for an explicitly confirmed paid generation.

## Windows

```powershell
winget install --id BlenderFoundation.Blender --source winget
winget install --id Gyan.FFmpeg --source winget
```

Restart the shell after installation. If `winget` exists but is missing from PATH, run `%LOCALAPPDATA%\Microsoft\WindowsApps\winget.exe` directly.

When Blender or FFmpeg is installed in a custom location:

```powershell
$env:BLENDER_BIN = "C:\path\to\blender.exe"
$env:FFMPEG_BIN = "C:\path\to\ffmpeg.exe"
npm run doctor
```

Configure a HiAPI key for only the current PowerShell process without placing it in history:

```powershell
$hiapiSecret = Read-Host "HiAPI API Key" -AsSecureString
$env:HIAPI_API_KEY = [System.Net.NetworkCredential]::new("", $hiapiSecret).Password
npm run doctor
```

## macOS and Linux

Install Blender and FFmpeg through the platform's trusted package channel. Ensure `blender` and `ffmpeg` resolve on PATH, or set `BLENDER_BIN` and `FFMPEG_BIN` to absolute executable paths.

```bash
printf 'HiAPI API Key: ' >&2
read -r -s HIAPI_API_KEY
printf '\n' >&2
export HIAPI_API_KEY
npm run doctor
```

## Verification sequence

```bash
npm run doctor
npm test
npm run render -- examples/warehouse-pursuit/shot.json --out-dir outputs/warehouse-pursuit
```

Expected render artifacts are `previs.blend`, 144 PNG frames, a six-second `previs.mp4`, and `render-report.json`. The first run may be slower while Blender initializes preferences.

## No paid smoke test by default

`npm test` and `npm run render` do not call HiAPI. `npm run generate` is also non-paying until an exact preflight token is supplied. The repository intentionally has no automatic paid integration test.
