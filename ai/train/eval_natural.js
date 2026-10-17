#!/usr/bin/env node
"use strict";
/* Apply the finish stage to a "before" image:  node ai/train/eval_natural.js before.png out.png [natural=100] [calm=100] */
const sharp = require("sharp"), E = require("../../public/js/engine.js");
(async () => {
  const [inp, out, nat, calm] = [process.argv[2], process.argv[3], Number(process.argv[4] ?? 100), Number(process.argv[5] ?? 100)];
  const { data, info } = await sharp(inp).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const px = new Uint8ClampedArray(data);
  E.enhance({ data: px }, info.width, info.height, { natural: nat, calm: calm });
  await sharp(Buffer.from(px.buffer), { raw: { width: info.width, height: info.height, channels: 4 } }).removeAlpha().png().toFile(out);
})();
