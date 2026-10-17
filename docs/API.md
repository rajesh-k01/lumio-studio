# Lumio API

All routes are under `/api`. Errors are JSON: `{ "error": { "code": "...", "message": "..." } }`.
Requests that change data must send `X-Requested-With: lumio`. Sessions use the `lumio_session` cookie.

"VIP" routes return `401 auth_required` for guests and `403 vip_required` for signed-in users who have not claimed VIP (only possible when `LUMIO_VIP_POLICY=claim`).

## Public

| Method and path | Purpose |
|---|---|
| `GET /health` | `{ ok, name, vipPolicy, ai }` |
| `GET /features` | Feature registry, current user, entitlements |
| `GET /formulas/public/:code` | Apply a shared formula. No account needed. |

## Account

| Method and path | Body | Notes |
|---|---|---|
| `POST /auth/register` | `{ name, email, password }` | Password 8 to 200 characters. Returns `{ user }` and sets the cookie. 201. |
| `POST /auth/login` | `{ email, password }` | 401 `wrong_credentials` for any mismatch |
| `POST /auth/logout` | | |
| `GET /auth/me` | | `{ user }` or `{ user: null }` |
| `DELETE /auth/account` | `{ password }` | Deletes the user, sessions, projects and formulas |
| `POST /vip/claim` | | Only needed with the `claim` policy |

`user` is `{ id, email, name, tier, vip, vipSince }`.

## VIP

| Method and path | Purpose |
|---|---|
| `GET /projects` | `{ projects, usageBytes, quotaBytes }` |
| `POST /projects` | `{ name, mode, settings, thumb? }` |
| `GET /projects/:id`, `PUT /projects/:id`, `DELETE /projects/:id` | Read, update, delete |
| `PUT /projects/:id/image` | Raw PNG, JPEG or WebP body. Counts against the quota. |
| `GET /projects/:id/image` | The saved image |
| `GET /formulas`, `POST /formulas`, `DELETE /formulas/:id` | `{ name, settings }`. Returns an 8-character share code. |
| `POST /process?target=1080\|1440\|2160\|4320&scale=1..8&format=png\|jpeg\|webp&quality=` | Raw image body. `target` is the wanted short side in pixels (HD, 2K, 4K, 8K) and wins over `scale`. Output is capped by `LUMIO_MAX_PIXELS` and an 8192 px side, and `X-Lumio-Capped` says when that happened. Settings in header `X-Lumio-Settings` (URL-encoded JSON). 30 requests a minute per user. Response headers: `X-Lumio-Width`, `X-Lumio-Height`, `X-Lumio-Scale`, `X-Lumio-Capped`. |
| `POST /cutout?x=0..1&y=0..1&tol=1..100` | Raw image body. Returns a PNG with the background removed. 422 if the selection is almost the whole image. |
| `POST /ai/upscale?scale=2\|3\|4` | Raw image body, up to `LUMIO_AI_MAX_PIXELS` (default 0.3 MP). 501 `ai_unavailable` unless `LUMIO_AI=1`. |
| `POST /video/enhance?target=240..4320&speed=0.25..4&mirror=0\|1&start=&end=` | VIP. Raw video body with a `video/*` content type, settings in `X-Lumio-Settings`. Returns an MP4 (H.264 and AAC). 6 requests a minute per user. Headers: `X-Lumio-Width`, `X-Lumio-Height`, `X-Lumio-Capped`, `X-Lumio-Skipped` (effects FFmpeg could not apply). 501 `video_unavailable` without FFmpeg, 413 for files over 300 MB or clips over 5 minutes. |

## Settings object

Sent as `settings`. Unknown keys are dropped and numbers are clamped (`sanitize` in `public/js/engine.js`).

`denoise sharpen contrast clarity dehaze autowb skin glow tilt vignette grain fstr sstr` are 0 to 100.
`bright shadows highlights sat warm` are -50 to 50.
`filter` is one of 17 ids, `style` is `none`, `cartoon`, `sketch` or `mosaic`.

## AI options

- `POST /api/process?...&neural=1&faces=0..1` runs Real-ESRGAN (and GFPGAN faces) before the filters. The response header `X-Lumio-Neural` is `ai`, `ai+faces`, `too-large`, `not-needed`, `unavailable` or `off`.
- `POST /api/video/enhance?...&ai=1` enhances every frame with Real-ESRGAN. `X-Lumio-Neural` is `ai`, `too-long`, `not-needed`, `unavailable` or `off`.
- `POST /api/ai/upscale?scale=..&natural=..&faces=..` returns only the AI result.
