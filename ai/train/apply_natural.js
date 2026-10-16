#!/usr/bin/env node
"use strict";
/* Write fitted parameters (JSON from fit_natural.js) into public/js/engine.js:  node ai/train/apply_natural.js params.json */
const fs = require("fs"), path = require("path");
const file = path.join(__dirname, "..", "..", "public", "js", "engine.js"), p = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
delete p.fit;
let s = fs.readFileSync(file, "utf8");
const a = s.indexOf("/*NATURAL_PARAMS*/"), b = s.indexOf("/*END_NATURAL_PARAMS*/");
if (a < 0 || b < 0) throw new Error("markers not found in engine.js");
s = s.slice(0, a) + "/*NATURAL_PARAMS*/" + JSON.stringify(p) + s.slice(b);
fs.writeFileSync(file, s);
console.log("engine.js updated:", JSON.stringify(p).length, "bytes of parameters");
