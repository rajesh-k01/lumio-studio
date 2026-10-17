# Server video render (FFmpeg)

The browser exports video by recording the preview while it plays. That runs in real time, drops frames under heavy effects and cannot reach 8K. For 2K, 4K and 8K, VIP users can render on the server instead. Each frame is processed by FFmpeg, audio is kept, and the file is H.264 + AAC in an MP4.

## Requirements

`ffmpeg` and `ffprobe` on the server's PATH (or set `LUMIO_FFMPEG` and `LUMIO_FFPROBE`). The server checks both at start and reports `ffmpeg: true` in `GET /api/health`. With `LUMIO_VIDEO=0`, or without FFmpeg, `POST /api/video/enhance` answers 501 `video_unavailable` and the app hides the "Render on server" option.

## Request

`POST /api/video/enhance?target=1080&speed=1&mirror=0&start=0&end=`

- Body: the raw video, with a `video/*` content type.
- `X-Lumio-Settings`: URL-encoded JSON of the enhancement settings (same object as photos, sanitized on the server).
- `target`: wanted short side in pixels, 240 to 4320 (1080 HD, 1440 2K, 2160 4K, 4320 8K). The output is capped at `maxVideoPixels` (34 MP), so 8K 16:9 (33.2 MP) fits and anything larger is scaled down. `X-Lumio-Capped: 1` says when that happened.
- Limits: 300 MB upload, 5 minutes of video, 6 requests a minute per user, one render at a time per server (a second request answers 429 `busy`; change `videoConcurrency` in `server/config.js` if the machine can take more), and a 20 minute render limit (504 `video_timeout`).
- Response headers: `X-Lumio-Width`, `X-Lumio-Height`, `X-Lumio-Capped`, `X-Lumio-Skipped`.

## What FFmpeg does and does not match

The browser preview and the server render use different code, so they are close but not identical. Mapping, from `server/ffmpegFilters.js`:

| Lumio setting | FFmpeg filter | Match |
|---|---|---|
| Denoise | `hqdn3d` | approximate |
| Resolution | `scale` with Lanczos | exact size |
| Auto color, contrast | `normalize` | approximate |
| Brightness, dehaze, saturation | `eq` | approximate |
| Shadows, highlights | `curves` | approximate |
| Warmth | `colorbalance` | approximate |
| Clarity, sharpen | `unsharp` (kernel grows with output size) | approximate |
| Black and white, sepia filters | `hue`, `colorchannelmixer` | close |
| Vignette, grain | `vignette`, `noise` | approximate |
| Speed, mirror | `setpts` + `atempo` chain, `hflip` | exact |
| Skin smoothing, glow, tilt blur, art styles, the other filters | none | **skipped** |

Skipped effects are listed in `X-Lumio-Skipped` and the app tells the user which ones were left out. Stabilization and frame blending only exist in the browser.

## Tested

The test suite renders a real clip through the route, including one 7680x4320 output, and checks the size, the audio track and the skipped list. Visual closeness to the browser preview was not compared frame by frame.
