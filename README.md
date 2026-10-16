# Lumio Studio

A photo and video enhancer in the spirit of Wink, built as a full-stack web app. Every tool is free. Tools marked VIP unlock when a user signs in, and VIP costs nothing.

- **Frontend:** plain HTML, CSS and JavaScript in `public/`. No build step.
- **Backend:** Node.js, Express and the built-in `node:sqlite` database in `server/`.
- **Shared engine:** `public/js/engine.js` runs in the browser and on the server, so a local preview and a cloud render match.
- **Docs:** `docs/WINK_ANALYSIS.md` (research and feature matrix), `docs/API.md`, `docs/AI_WORKER.md` (neural upscale, measured), `docs/VIDEO_WORKER.md` (FFmpeg render up to 8K), `docs/TRAINING.md` (how to train a better enhancer), `docs/BUGS_AND_ERRORS.md` (what was tested and fixed).

## Run it

Needs Node.js 22.13 or newer.

```bash
npm install
npm start          # http://localhost:3000
npm test           # backend and engine tests
```

No server? Run `npm run bundle` and open `dist/lumio-standalone.html`. It starts in **demo mode**: editing works fully, and accounts, projects and formulas are stored in that browser only.

## Free and VIP

| | Free, no account | VIP, free with sign-in |
|---|---|---|
| AI enhance (photo and video), denoise, sharpen, dehaze, auto color, presets, HD (1080), 2K and 4K output | yes | |
| Skin smoothing, glow, portrait blur, light and color, 9 filters, vignette, grain | yes | |
| Crop, text, stickers, collage, HD video export (720p and 1080p), trim, speed, captions, script-to-captions, soundtrack, WAV extract | yes | |
| 8 more filters, cartoon, sketch and mosaic styles, Old photo restore preset | | yes |
| Remove object, cutout, batch to ZIP, 8K photo output, 2K and 4K video export, server video render up to 8K | | yes |
| Retouch brushes: teeth whitening, lips and blush, hair color, face and body reshape | | yes |
| Video stabilization and frame blending | | yes |
| Projects, formulas with share codes, cloud render, optional neural upscale | | yes |

The full list of 51 features, with build status, is in `docs/WINK_ANALYSIS.md` and on the app's "Free and VIP" page. Both are generated from `public/js/features.js`.

**What is enforced where.** The server enforces VIP on the cloud routes (projects, saved formulas, render, cutout, AI upscale). Local tools run in the user's browser, so their VIP gating is a UI gate, not a security boundary. That fits a free VIP model, but it means a determined user can bypass the local gates.

`LUMIO_VIP_POLICY=auto` (default) makes every new account VIP. `claim` makes users press "Claim VIP" after signing up.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | 3000 | HTTP port |
| `LUMIO_DB` | `data/lumio.db` | SQLite file |
| `LUMIO_VIP_POLICY` | `auto` | `auto` or `claim` |
| `LUMIO_MAX_PIXELS` | 36000000 | Output cap for cloud render |
| `COOKIE_SECURE` | off | Set to `1` behind HTTPS |
| `TRUST_PROXY` | off | Set to `1` behind a reverse proxy so rate limits see real IPs |
| `LUMIO_AI` | off | Set to `1` to enable neural upscale (see `docs/AI_WORKER.md`) |
| `LUMIO_PYTHON` | `python3` | Python used by the AI worker. Needs OpenCV contrib 4.x, not 5.x |
| `LUMIO_AI_ENGINE` | `realesrgan` | `realesrgan` (damaged photos, needs torch) or `edsr` (clean enlargement, needs OpenCV 4.x) |
| `LUMIO_AI_MODELS` | `ai/models` | Folder holding `realesr-general-x4v3.pth` or `EDSR_x2.pb` and friends |
| `LUMIO_AI_TIMEOUT_MS` | 300000 | Time limit for one neural request |
| `LUMIO_AI_FACES` | off | Set to `1` to add GFPGAN face restoration after the neural upscale (see `docs/AI_WORKER.md`) |
| `LUMIO_VIDEO_AI_MAX_FRAMES` | 90 | Longest clip (in frames) that gets AI enhancement; longer clips use the normal render |
| `LUMIO_VIDEO_AI_MAX_SHORT` | 360 | AI video works on frames whose short side is at most this many pixels, then upscales |
| `LUMIO_AI_MAX_PIXELS` | 1000000 (300000 for EDSR) | Largest input for neural upscale |
| `LUMIO_VIDEO` | on | Set to `0` to turn off the FFmpeg video render |
| `LUMIO_FFMPEG`, `LUMIO_FFPROBE` | `ffmpeg`, `ffprobe` | Paths to the FFmpeg tools |
| `LUMIO_WORKERS` | 2 | Image worker threads |

## Testing

```bash
npm test         # 34 engine and server tests (a 35th runs the real neural worker when LUMIO_TEST_PYTHON is set)
npm run lint     # ESLint
npm run fuzz     # hostile-input fuzzing of the engine and the server API
node test/ui/smoke.js   # UI smoke test in jsdom, needs `npm i --no-save jsdom canvas` (see the file header)
```

## Security notes

- Passwords are hashed with scrypt. Sessions are random 32-byte tokens in an httpOnly, SameSite=Lax cookie. Only a SHA-256 hash of each token is stored.
- State-changing requests need the header `X-Requested-With: lumio` (CSRF guard).
- Login and registration are rate limited. Login timing does not reveal whether an email exists.
- A Content Security Policy blocks inline scripts and third-party scripts.
- Uploads are validated with `sharp` and capped by size and pixel count. Each user has a storage quota.
- Rate limits are in memory, so they reset on restart and are per process. Use a shared store if you run several instances.

## Known limits

- **No trained models ship with Lumio.** Face and body tools are brush-based, not automatic. Automatic captions from speech are the only feature not built. Stabilization is basic and frame blending is not true interpolation.
- **"AI enhance" is image analysis, not a neural network.** It measures noise, softness, exposure, clipping, color cast and haze, then sets the sliders. It will not match Remini, Wink or Gemini on badly damaged photos, because those add generated detail from large trained models. `docs/TRAINING.md` shows how to train one.
- **Resolution up to 8K is resampling plus sharpening** unless the optional neural worker is on. It makes the file bigger and cleaner, but it cannot invent real detail. With the optional neural worker on (Real-ESRGAN, plus GFPGAN for faces) real detail is added. On a real phone portrait the face came out in the same class as Wink (natural eyes, smooth skin, same brightness), but Wink still draws crisper fine detail such as embroidery. One photo was compared, so this is an example, not a benchmark. See `docs/AI_WORKER.md`.
- **Object removal and cutout are classic algorithms.** They suit small objects and plain backgrounds.
- **Browser video export is real time.** The browser records the processed video while it plays, so heavy effects at large sizes can drop frames and 8K is not possible there. For 2K, 4K and 8K use the server render (needs FFmpeg), which approximates most effects and skips a few; the app lists what it skipped. See `docs/VIDEO_WORKER.md`.
- **Browser testing.** The UI was tested with jsdom and a canvas implementation, and the API client against the live server. It has not been tested in a real browser with a real GPU and layout, so expect to find visual issues on first run.
- **Photos are edited at up to 4096 px on the long side**, and browser exports are capped at 36 megapixels.
