"use strict";
/* Inlines css and js into dist/lumio-standalone.html so the app runs from a single file (demo mode, no server). */
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..", "public");
let html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const safe = (s) => s.replace(/<\/script/gi, "<\\/script");
html = html.replace(/<link rel="stylesheet" href="(css\/[^"]+)">/g, (_, p) => "<style>\n" + fs.readFileSync(path.join(root, p), "utf8") + "\n</style>");
html = html.replace(/<script src="(js\/[^"]+)"><\/script>/g, (_, p) => "<script>\n" + safe(fs.readFileSync(path.join(root, p), "utf8")) + "\n</script>");
fs.mkdirSync(path.join(__dirname, "..", "dist"), { recursive: true });
const out = path.join(__dirname, "..", "dist", "lumio-standalone.html");
fs.writeFileSync(out, html);
console.log("Wrote " + out + " (" + Math.round(html.length / 1024) + " KB)");
