/*
 * Lumio feature registry: the single source of truth for what is free, what needs
 * a login (VIP), and what is actually built.
 *
 * tier:   "free"  works for everyone, no account
 *         "vip"   unlocked by signing in (VIP is free with a login)
 * status: "ready"        implemented and working
 *         "optional"     implemented, needs an extra server component (see docs)
 *         "needs-model"  needs a trained AI model; not built yet
 *         "planned"      not built yet
 * wink:   the matching Wink capability, for the parity matrix in docs/WINK_ANALYSIS.md
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.LumioFeatures = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var CATEGORIES = [
    { id: "enhance", label: "Enhance", blurb: "Fix noise, softness and color" },
    { id: "retouch", label: "Retouch", blurb: "Portrait and face tools" },
    { id: "color", label: "Color and filters", blurb: "Light, color and looks" },
    { id: "style", label: "Creative styles", blurb: "Turn photos into art" },
    { id: "edit", label: "Edit", blurb: "Crop, text, remove, export" },
    { id: "video", label: "Video", blurb: "Enhance and edit clips" },
    { id: "cloud", label: "Cloud", blurb: "Sync, share and render" }
  ];

  var F = [
    // Enhance
    ["enhance.denoise", "Noise reduction", "enhance", "free", "ready", "both", "Edge-aware denoising that keeps detail.", "Noise reduction"],
    ["enhance.sharpen", "Sharpen", "enhance", "free", "ready", "both", "Unsharp mask that scales with image size.", "AI Repair sharpening"],
    ["enhance.contrast", "Auto contrast", "enhance", "free", "ready", "both", "Stretches tones using the image histogram.", "AI Color"],
    ["enhance.clarity", "Clarity and detail", "enhance", "free", "ready", "both", "Local contrast for punchier texture.", "Fix strength"],
    ["enhance.dehaze", "Dehaze", "enhance", "free", "ready", "both", "Removes the milky veil from hazy shots.", "Quality repair"],
    ["enhance.autowb", "Auto color balance", "enhance", "free", "ready", "both", "Neutralizes color casts with a gray-world balance.", "AI Color"],
    ["enhance.upscale", "Resolution: HD, 2K and 4K", "enhance", "free", "ready", "photo", "Resize to 1080, 1440 or 2160 px on the short side, with sharpening.", "Super resolution"],
    ["enhance.smart", "AI enhance", "enhance", "free", "ready", "both", "Reads the image and picks noise, sharpness, light and color settings.", "AI Repair"],
    ["enhance.presets", "One-tap presets", "enhance", "free", "ready", "both", "Auto fix, AI color, Portrait, Night view, Landscape.", "AI Repair Pro modes"],
    ["enhance.nightview", "Night view", "enhance", "free", "ready", "both", "Lifts shadows and cleans low-light noise.", "Night view model"],
    ["enhance.upscale8", "Resolution: 8K", "enhance", "vip", "ready", "photo", "Export at 4320 px on the short side, up to 36 megapixels.", "4K / Ultra HD export"],
    ["enhance.restore", "Old photo restore", "enhance", "vip", "ready", "photo", "Heavy denoise, color-cast fix and contrast for faded prints.", "Old photo restoration"],
    ["enhance.neural", "Neural super resolution", "enhance", "vip", "optional", "photo", "Real AI upscaling through the optional Python worker.", "AI super resolution"],

    // Retouch
    ["retouch.skin", "Skin smoothing", "retouch", "free", "ready", "both", "Smooths skin tones while keeping edges.", "Skin smoothing"],
    ["retouch.glow", "Soft glow", "retouch", "free", "ready", "both", "Dreamy highlight bloom.", "Lighting correction"],
    ["retouch.focus", "Portrait focus blur", "retouch", "free", "ready", "photo", "Blurs the edges of the frame around a sharp center.", "Background effects"],
    ["retouch.face", "Face reshape", "retouch", "vip", "ready", "photo", "Push, pinch and bloat with a brush.", "Face and jawline shaping"],
    ["retouch.makeup", "Lips and blush color", "retouch", "vip", "ready", "photo", "Paint a color on, keeping light and shadow.", "Makeup filters"],
    ["retouch.teeth", "Teeth whitening", "retouch", "vip", "ready", "photo", "Brush over teeth to brighten and remove yellow.", "Teeth whitening"],
    ["retouch.body", "Body reshape", "retouch", "vip", "ready", "photo", "Slim and shape with the same brush.", "Body reshaping"],
    ["retouch.hair", "Hair color", "retouch", "vip", "ready", "photo", "Brush a new color over hair.", "Hair color and volume"],

    // Color
    ["color.tone", "Brightness, shadows, highlights", "color", "free", "ready", "both", "Tone controls with soft roll-off.", "Color adjustments"],
    ["color.sat", "Saturation and warmth", "color", "free", "ready", "both", "Color intensity and temperature.", "Color adjustments"],
    ["color.filters", "Classic filters", "color", "free", "ready", "both", "Nine looks: Cinematic, Vivid, Film, B and W, Sepia and more.", "Filters"],
    ["color.vignette", "Vignette and film grain", "color", "free", "ready", "both", "Edge darkening and organic grain.", "Retro digital camera"],
    ["color.filters.pro", "Pro filters", "color", "vip", "ready", "both", "Eight more: Noir, Matte, Teal and orange, Golden hour, Cyber, Retro, Dream, Posterize.", "Exclusive effects"],

    // Styles
    ["style.cartoon", "Cartoon", "style", "vip", "ready", "photo", "Flat colors with ink outlines.", "Anime and cartoon styles"],
    ["style.sketch", "Pencil sketch", "style", "vip", "ready", "photo", "Pencil drawing from any photo.", "Art styles"],
    ["style.mosaic", "Pixel mosaic", "style", "vip", "ready", "photo", "Blocky pixel art.", "Mosaic effect"],

    // Edit
    ["edit.crop", "Crop, rotate, mirror", "edit", "free", "ready", "photo", "Common aspect ratios, 90 degree turns and flips.", "Crop and rotate"],
    ["edit.text", "Text and stickers", "edit", "free", "ready", "both", "Draggable text and emoji stickers.", "Text and stickers"],
    ["edit.collage", "Collage", "edit", "free", "ready", "photo", "Four layouts with gap and color.", "Collage templates"],
    ["edit.export", "Export format and size", "edit", "free", "ready", "photo", "PNG, JPG or WebP with quality and size limits.", "Compression and format conversion"],
    ["edit.remove", "Remove object", "edit", "vip", "ready", "photo", "Paint over a passerby or sign and fill it in.", "AI Remover"],
    ["edit.cutout", "Background cutout", "edit", "vip", "ready", "photo", "Transparent PNG from plain backgrounds.", "Cutout"],
    ["edit.batch", "Batch photos", "edit", "vip", "ready", "photo", "Enhance many photos with one setting.", "Batch processing"],

    // Video
    ["video.enhance", "Live video enhancement", "video", "free", "ready", "video", "All enhancement tools applied to every frame.", "Video enhancement"],
    ["video.export720", "HD export (720p and 1080p)", "video", "free", "ready", "video", "Real-time recording in the browser.", "Export"],
    ["video.speed", "Speed, trim, mirror", "video", "free", "ready", "video", "0.5x to 2x, trim handles and mirror.", "Video editing"],
    ["video.captions", "Captions", "video", "free", "ready", "video", "Type captions with timings, burned into export.", "AI captions"],
    ["video.soundtrack", "Soundtrack and audio mix", "video", "free", "ready", "video", "Mix a music track with the original audio.", "Soundtrack"],
    ["video.audio", "Extract audio", "video", "free", "ready", "video", "Save the audio of a clip as WAV.", "Audio extraction"],
    ["video.export1080", "2K and 4K export", "video", "vip", "ready", "video", "Browser recording at 1440 or 2160 px. Heavy effects can drop frames.", "HD / 2K export"],
    ["video.server", "Server video render, up to 8K", "video", "vip", "optional", "video", "Frame-accurate FFmpeg render with denoise, sharpening and color. Needs FFmpeg on the server.", "4K and 8K video"],
    ["video.script", "Script to captions", "video", "free", "ready", "video", "Paste a script and Lumio times it across the clip.", "AI captions"],
    ["video.autocaptions", "Auto captions from speech", "video", "vip", "needs-model", "video", "Needs a speech recognition model.", "Automatic subtitles"],
    ["video.stabilize", "Basic stabilization", "video", "vip", "ready", "video", "Steadies small shakes and zooms in slightly.", "Stabilization"],
    ["video.interp", "Frame blending", "video", "vip", "ready", "video", "Smoother slow motion by blending frames.", "Frame interpolation"],

    // Cloud
    ["cloud.projects", "Cloud projects", "cloud", "vip", "ready", "both", "Save projects and photos to your account.", "Cloud storage"],
    ["cloud.formulas", "Save and share formulas", "cloud", "vip", "ready", "both", "Share a look as a short code. Anyone can apply a code.", "Expert formulas"],
    ["cloud.render", "Cloud render", "cloud", "vip", "ready", "photo", "Render large images on the server with Lanczos resize.", "Priority processing"]
  ];

  var FEATURES = F.map(function (r) {
    return { id: r[0], name: r[1], category: r[2], tier: r[3], status: r[4], mode: r[5], blurb: r[6], wink: r[7] };
  });

  var FILTERS = [
    { id: "none", label: "None", tier: "free" }, { id: "cinematic", label: "Cinematic", tier: "free" },
    { id: "vivid", label: "Vivid", tier: "free" }, { id: "film", label: "Film", tier: "free" },
    { id: "bw", label: "Black and white", tier: "free" }, { id: "sepia", label: "Sepia", tier: "free" },
    { id: "cool", label: "Cool", tier: "free" }, { id: "warm", label: "Warm", tier: "free" },
    { id: "fade", label: "Fade", tier: "free" },
    { id: "noir", label: "Noir", tier: "vip" }, { id: "matte", label: "Matte", tier: "vip" },
    { id: "tealorange", label: "Teal and orange", tier: "vip" }, { id: "golden", label: "Golden hour", tier: "vip" },
    { id: "cyber", label: "Cyber", tier: "vip" }, { id: "retro", label: "Retro", tier: "vip" },
    { id: "dream", label: "Dream", tier: "vip" }, { id: "posterize", label: "Posterize", tier: "vip" }
  ];
  var STYLES = [
    { id: "none", label: "None", tier: "free" }, { id: "cartoon", label: "Cartoon", tier: "vip" },
    { id: "sketch", label: "Sketch", tier: "vip" }, { id: "mosaic", label: "Mosaic", tier: "vip" }
  ];
  var PRESET_TIERS = { "Old photo restore": "vip" };

  /* Output resolutions are named by the short side, the way video is: 1080 means 1080p. */
  var RESOLUTIONS = [
    { id: "orig", label: "Original", short: 0, tier: "free" }, { id: "hd", label: "HD", short: 1080, tier: "free" },
    { id: "2k", label: "2K", short: 1440, tier: "free" }, { id: "4k", label: "4K", short: 2160, tier: "free" },
    { id: "8k", label: "8K", short: 4320, tier: "vip" }
  ];
  var VIDEO_RESOLUTIONS = [
    { id: "720", label: "720p", short: 720, tier: "free" }, { id: "hd", label: "HD", short: 1080, tier: "free" },
    { id: "2k", label: "2K", short: 1440, tier: "vip" }, { id: "4k", label: "4K", short: 2160, tier: "vip" },
    { id: "8k", label: "8K", short: 4320, tier: "vip", server: true }
  ];
  function resById(list, id) { for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i]; return list[0]; }

  function byId(id) { for (var i = 0; i < FEATURES.length; i++) if (FEATURES[i].id === id) return FEATURES[i]; return null; }
  function tierOfFilter(id) { for (var i = 0; i < FILTERS.length; i++) if (FILTERS[i].id === id) return FILTERS[i].tier; return "free"; }
  function tierOfStyle(id) { for (var i = 0; i < STYLES.length; i++) if (STYLES[i].id === id) return STYLES[i].tier; return "free"; }

  /* True when the given settings use something that needs VIP. */
  function settingsNeedVip(s) {
    s = s || {};
    return tierOfFilter(s.filter) === "vip" || tierOfStyle(s.style) === "vip";
  }

  function summary() {
    var out = { total: FEATURES.length, free: 0, vip: 0, ready: 0, pending: 0 };
    FEATURES.forEach(function (f) {
      out[f.tier]++;
      if (f.status === "ready" || f.status === "optional") out.ready++; else out.pending++;
    });
    return out;
  }

  return {
    RESOLUTIONS: RESOLUTIONS, VIDEO_RESOLUTIONS: VIDEO_RESOLUTIONS, resById: resById,
    CATEGORIES: CATEGORIES, FEATURES: FEATURES, FILTERS: FILTERS, STYLES: STYLES, PRESET_TIERS: PRESET_TIERS,
    byId: byId, tierOfFilter: tierOfFilter, tierOfStyle: tierOfStyle, settingsNeedVip: settingsNeedVip, summary: summary
  };
});
