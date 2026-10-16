# Bugs and errors: what was checked, found and fixed

Everything here was run, not guessed. Re-run it yourself with `npm test`, `npm run lint` and `npm run fuzz`.

## How it was checked

| Tool | What it covers | Result |
|---|---|---|
| `npm test` | 39 tests: engine maths, feature registry, the whole server API, FFmpeg filter builder, a real 8K video render. Four more run the real neural workers (EDSR with `LUMIO_TEST_PYTHON`, Real-ESRGAN with `LUMIO_TEST_TORCH_PYTHON`, faces with `LUMIO_TEST_FACE_IMAGE` too) and are skipped unless you set those | 36 pass, 3 skipped; 39 of 39 pass with all workers set up |
| `node test/ui/smoke.js` | 58 checks of the UI in jsdom with a canvas library (tiles, tool panels, AI enhance, resolution chips, brushes with real pointer events, export, video panel, VIP gates). Needs `jsdom` and `canvas` installed separately | 58 pass, 0 fail |
| `npm run lint` (ESLint 9, `eslint.config.js`) | undefined variables, unused code, `==` mistakes, redeclared names | 0 errors, 0 warnings |
| `npm run fuzz` > `test/fuzz/engine.fuzz.js` | 744 runs of the image engine on 1x1 to 255x3 images (black, white, grey, noise, ramp) and on hostile settings (NaN, Infinity, strings, `null`, `__proto__`) | 0 problems. No crash, no NaN or Infinity in any pixel, no setting outside its limits, no prototype pollution |
| `npm run fuzz` > `test/fuzz/server.fuzz.js` | the real server with two users: bad JSON, junk fields, missing CSRF header, unauthenticated calls, another user's project ids, corrupt and empty images, a 256 megapixel decompression bomb, bad query values, path tricks, garbage "videos", brute-force login | 0 problems. No 5xx, no crash, no data leak between users |

## Bugs found and fixed

| # | Bug | How it showed up | Fix |
|---|---|---|---|
| 1 | An 8K request on a small image returned the wrong size | server test: an 80x45 image with `target=4320` came back 360 px high, because the scale was clamped to 8 | the scale cap for `target` is now 200, and the output pixel cap still applies |
| 2 | The page could fail to start when `fetch` was missing | jsdom smoke test threw during `init()` | `init()` now catches the failure and falls back to local mode |
| 3 | `ai/upscale.py` crashed on OpenCV 5.0 | first real run: `dnn_superres` is empty in 5.0, and the plain `cv2.dnn` importer cannot load EDSR's `DepthToSpace` layer. The script had never been run before | the script now checks for a usable `dnn_superres`, prints the exact install command if not, and tiles large inputs. Works on opencv-contrib 4.10 (see `AI_WORKER.md`) |
| 4 | The neural route's 4 MP limit was unrealistic | measured speed is about 0.5 ms per input pixel on 2 CPUs, so a 4 MP image would take far longer than the 180 s timeout | the cap is now 300,000 pixels by default and configurable with `LUMIO_AI_MAX_PIXELS` |
| 5 | Dead code | lint found 8 unused variables, a function and a stale lint directive | removed. One removal exposed a leftover assignment (`homeBuilt`), which lint caught immediately and which was removed too |

| 6 | AI enhance badly under-measured damage | tested on images with known noise and JPEG quality: noise sigma 10 plus JPEG q30 read as "noise 1.2" and got denoise 6 | analysis now also measures JPEG blockiness and flat-area grain. The same image now gets denoise about 55, a clean one about 9. Two false positives (an 8-pixel checkerboard) were caught by a test and fixed |
| 7 | Auto white balance turned skin pink | a real portrait in a green park with a yellow dress read as a "color cast" of 0.21 and got white balance 68 | white balance now only fires on a strong cast (above 0.35) |
| 8 | Skin smoothing barely worked | on a real portrait it changed the face by 1.6 out of 255. The skin mask missed shaded skin (right cheek 59% covered) and used a hard on or off edge | new soft skin mask, a blur that only averages skin pixels, an edge guard for eyes and lips, and a wider radius. (A variable-name clash introduced during this rewrite was caught by lint.) |
| 9 | AI enhance denoised so hard it erased fabric texture | side-by-side crop of a patterned dress | automatic denoise is capped at 55, because the classical denoiser cannot tell texture from grain |
| 10 | Neural export ignored the chosen resolution | the export asked for 2x or 4x only, then resized | it now requests the exact factor, and backs off follow-up denoise and sharpening so detail is not smeared twice |
| 11 | Face restoration could not use the `gfpgan` package | `basicsr` (a dependency) fails to build from PyPI with `KeyError: '__version__'`, with and without build isolation, and the maintained fork fails the same way | the two network files that are actually needed are vendored in `ai/gfpgan_arch/` with their Apache-2.0 licence, and the route was tested end to end |
| 12 | 8K export with AI failed | GFPGAN was run on a 33 megapixel image (a 6x neural result) and the worker failed | the network now runs at no more than 4x and faces are restored on that result; the exact 8K size comes from a Lanczos resize afterwards. 8K now completes (208 s on 2 CPUs) |

## What was checked and found fine

- Another user cannot read, change, delete or list your projects, images or formulas (tested on every project route).
- Registration and login reject non-string fields, oversized fields and header-injection attempts. A `__proto__` field in the body did not make the account VIP.
- Every state-changing call without `X-Requested-With: lumio` is refused.
- Protected routes answer 401 or 403 without a session, including `/process`, `/cutout`, `/video/enhance`.
- Truncated, empty, random and oversized images are rejected with a 4xx error, and the 256 MP image did not exhaust memory.
- `/server/config.js`, `/data/lumio.db`, `/.env` and path-traversal URLs do not expose files.
- Login is rate limited (429 within 40 wrong attempts).

## What this does not prove

- **The UI was never run in a real browser.** The smoke tests use jsdom and a canvas library, so layout, touch, GPU behaviour and real video decoding are untested. Expect some visual issues on first run.
- **Browser video export** (real time recording) was not tested with real clips at 2K or above. Server video render was tested with generated clips only.
- **Server render versus preview**: FFmpeg approximates the effects, and some are skipped. Closeness was not compared frame by frame.
- **Fuzzing finds crashes and leaks, not wrong-looking results.** Whether "AI enhance" picks good settings on your photos is a judgement call. It is analysis-based, not a neural network, and was only checked on synthetic and a few bundled photos.
- **Uploads over the size limits** (25 MB images, 300 MB video) were not sent in full.
- **Rate limits are in memory.** They reset when the server restarts and are per process.
- Nothing here is a security audit. Run it behind HTTPS with `COOKIE_SECURE=1` and `TRUST_PROXY=1` behind a proxy.
| 13 | Finish stage fitted on a chain the app does not use | the real UI's AI enhance HD was brighter (L* 138.7) and less saturated (80.7) than the test harness | the app analyses a 512 px thumbnail (contrast 6) where the harness used full resolution (contrast 25), so the fixes differed; the pair was regenerated with the app's own analysis and refitted |

