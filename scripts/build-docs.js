"use strict";
/* Builds docs/WINK_ANALYSIS.md from the template, filling the feature matrix from the live registry. */
const fs = require("fs");
const path = require("path");
const F = require("../public/js/features.js");

const root = path.join(__dirname, "..");
const tpl = fs.readFileSync(path.join(root, "docs", "WINK_ANALYSIS.template.md"), "utf8");

const cell = (s) => String(s).replace(/\|/g, "/");
const label = { free: "Free", vip: "VIP" };
let matrix = "";
F.CATEGORIES.forEach((c) => {
  const rows = F.FEATURES.filter((f) => f.category === c.id);
  matrix += "### " + c.label + "\n\n| Wink capability | Lumio feature | Tier | Status | Notes |\n|---|---|---|---|---|\n";
  rows.forEach((f) => {
    matrix += "| " + cell(f.wink) + " | " + cell(f.name) + " | " + label[f.tier] + " | " + f.status + " | " + cell(f.blurb) + " |\n";
  });
  matrix += "\n";
});

const s = F.summary();
const free = F.FEATURES.filter((f) => f.tier === "free"), vip = F.FEATURES.filter((f) => f.tier === "vip");
const readyN = (a) => a.filter((f) => f.status === "ready" || f.status === "optional").length;
const summary =
  "| | Features | Built | Not built yet |\n|---|---|---|---|\n" +
  "| Free, no account | " + free.length + " | " + readyN(free) + " | " + (free.length - readyN(free)) + " |\n" +
  "| VIP, free with a login | " + vip.length + " | " + readyN(vip) + " | " + (vip.length - readyN(vip)) + " |\n" +
  "| **Total** | **" + s.total + "** | **" + s.ready + "** | **" + s.pending + "** |\n";

const out = tpl.replace("<!-- MATRIX -->", matrix.trim()).replace("<!-- SUMMARY -->", summary.trim());
fs.writeFileSync(path.join(root, "docs", "WINK_ANALYSIS.md"), out);
console.log("Wrote docs/WINK_ANALYSIS.md (" + s.total + " features, " + s.ready + " built)");
