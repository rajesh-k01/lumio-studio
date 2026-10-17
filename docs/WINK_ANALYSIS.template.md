# Wink analysis and the Lumio plan

This report studies Wink (Meitu's video and photo enhancer), identifies what it does well and where users struggle, and maps every Wink capability to a Lumio feature with a free or VIP tier and an honest build status.

**How this was researched.** The findings come from public sources: the App Store listing and release notes, third-party reviews, and an app-review aggregator. Several reviewers are Wink competitors, so their test results favor their own products and are treated as claims, not facts. No hands-on testing of Wink was done. Prices differ by region, platform and date, so treat the numbers as a snapshot.

## 1. What Wink is

- A video-first enhancer and editor made by Meitu, with about 52,000 App Store ratings averaging 4.7.
- Available as a mobile app, in the browser (Wink Web), and reportedly on desktop. Features and pricing differ between these surfaces.
- Core promise: take low-quality video or photos and make them look HD or 4K with one tap, then retouch faces and bodies.

## 2. Feature inventory

| Area | What Wink offers |
|---|---|
| Enhancement | AI repair and super resolution up to 4K, noise reduction, unblur, color enhancement, adjustable fix strength |
| Scene models | Seven models for cases such as gaming clips, night footage and old photo restoration; an automatic "Pro" mode that detects the problem |
| Batch | Process several photos or clips at once, including super resolution and AI removal |
| Face retouch | Skin smoothing, lighting correction, wrinkle and under-eye smoothing, teeth whitening, jaw and face shaping, makeup, lip effects, hair color and volume, per-face edits in group videos |
| Body retouch | Reshape, slimming, posture, proportions, with background protection |
| Creative | Retro digital camera look, anime and cartoon styles, live wallpapers, AI transitions, trending effects |
| Editing | Collage templates, Live Photo editing, stitching clips with several aspect ratios, compression and format conversion, audio extraction, doodle pen |
| Captions | Automatic captions in 10 or more languages |
| Video extras | Stabilization, frame interpolation, motion blur correction (reported by reviewers) |
| Sharing and sync | "Formulas" that apply a saved set of beauty and color settings in one tap, a Trending tab, cloud storage across devices |

## 3. How Wink makes money

- **Subscriptions (US App Store):** weekly VIP $7.99, monthly VIP $12.99, yearly VIP $59.99, VIP+ $19.99 monthly or $99.99 yearly, and a $0.99 one-off AI Photo Restore. One comparison article lists a different monthly price, so verify before quoting.
- **Credits:** one-off packs run from about 25 credits for $7.99 up to 1,000 for $79.99. On Wink Web, a free entry tier plus Standard (1,000 credits a month) and Pro (4,000), with credits expiring after about a month and consumption depending on the job and file size.
- **What VIP unlocks:** unlimited 4K enhancement, premium models, exclusive effects, watermark-free export and priority processing. Free use is limited and exports may carry a watermark.

## 4. What users like

- Visible improvement on blurry or compressed clips, especially for social edits.
- A simple interface with powerful retouch and makeup tools bundled in the same app.
- One tool for enhancement, retouching and editing across phone, web and desktop.

## 5. Where users struggle

| Pain point | Evidence | Lumio response |
|---|---|---|
| Paywalled quality | HD, 2K and 4K need a subscription; users call VIP expensive | Everything that runs locally is free with no watermark; VIP is free with a login |
| Tiny free allowance | Users report a handful of free repairs, a removed daily allowance and a cap of about 15 photos | No usage caps on local processing |
| Credit friction | Credit cost depends on the job and is hard to predict; credits expire | No credits at all |
| Reliability | Frequent "failed to repair" errors, videos turning black, very long waits | Processing runs on the user's device; the cloud render is optional |
| Length limits | Repair reportedly works on about a minute of video at a time | Local video export is limited only by the device |
| Over-processing | Reviewers report over-smoothed faces and artificial detail at high strength | Every effect has a strength slider and a before/after comparison |
| Few fine controls | One reviewer says advanced users get little tuning | Dozens of independent sliders plus presets |
| Cloud dependence | Needs a stable connection and service availability | Works offline once loaded |
| Hard cases | Hair, fabric, small text and very low-resolution sources recover poorly | Same limit applies to Lumio; stated openly |

## 6. Competitors

| App | Focus | Pricing noted by one comparison |
|---|---|---|
| Remini | Photo restoration, faces and old scans | $4.99 to $9.99 a week; tight free limits |
| Winkit | Video enhancement, 4K, filters | $6.99 a week or $49.99 a year, plus credits |
| YouCam Enhance | Photo and video restoration plus generative tools | $4.99 a week to $79.99 a year; reported cancellation and server complaints |
| Topaz and desktop tools | High-end upscaling | One-time or subscription licenses, desktop only |

## 7. Opportunity for Lumio

1. **Trust.** Free means free: no watermark, no credits, no countdown to a paywall.
2. **Privacy and speed.** Photos stay on the device unless the user chooses cloud render or cloud save.
3. **Control.** Every effect is a visible slider with a live before/after, plus shareable formulas.
4. **Simple VIP.** Signing in unlocks the extra tools. Nothing is sold.
5. **Honesty.** Each feature shows whether it is built, optional or waiting on a trained model.

## 8. Feature matrix: Wink capability to Lumio feature

Generated from `public/js/features.js`, which is the single source of truth. Tier **Free** works without an account. Tier **VIP** unlocks with a login. Status **ready** is built and tested, **optional** needs the Python worker, **needs-model** and **planned** are not built yet.

<!-- MATRIX -->

## 9. Honest gaps

Lumio uses classic image processing, not trained models. What that means in practice:

- **Detail recovery.** Classical upscaling sharpens but cannot invent real detail. The optional neural upscaler (`ai/upscale.py`) narrows the gap on photos, but it has not been run against real model files.
- **Face and body tools are manual.** Teeth whitening, lip and blush color, hair color and reshaping all work with a brush that the user paints. Wink detects faces and bodies automatically, so it is faster and more precise on portraits. Lumio's reshape is a liquify warp: it can distort the background if the brush is large.
- **Captions are typed or scripted.** Lumio times a pasted script across the clip. It does not listen to speech, so automatic captions from audio are the one feature not built.
- **Stabilization is basic.** It steadies small shakes with a smoothed camera path and a 10% zoom. It does not handle rolling shutter or large motion.
- **Frame blending is not interpolation.** It blends neighboring frames for smoother slow motion. It does not synthesize new frames from motion estimation.
- **Object removal and cutout** suit small objects and plain backgrounds.

Anything not built is marked `needs-model` in the registry.

## 10. Free and VIP at a glance

<!-- SUMMARY -->

## Sources

- [Wink on the App Store](https://apps.apple.com/us/app/1594288016): feature list, release notes, ratings, subscription prices
- [Wink Video Enhancer review, UniFab](https://unifab.ai/resource/wink-video-enhancer.htm): web credits, free limits, quality tests (competitor)
- [Wink review, Aiarty](https://www.aiarty.com/ai-video-enhancer/wink-video-enhancer-review.htm): platforms, features, credit packs (competitor)
- [Wink reviews, JustUseApp](https://justuseapp.com/en/app/1594288016/wink-video-enhancing-tool/reviews): user praise and complaints, summarized
- [Best AI photo and video enhancer apps for iPhone, AppsHunter](https://appshunter.io/blog/best-ai-photo-video-enhancer-apps-iphone): competitor pricing
- [Wink: Video Enhancer and Editor listing, Gizmodo](https://gizmodo.com/download/wink-video-enhancer-editor): platforms and feature summary
