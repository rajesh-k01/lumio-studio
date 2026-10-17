"use strict";
/* Runs one heavy image job off the main thread so the API stays responsive. */
const { parentPort, workerData } = require("worker_threads");
const engine = require("../public/js/engine.js");

const { kind, buffer, width, height, settings, x, y, thr } = workerData;
const data = new Uint8ClampedArray(buffer);
let removed = 0;

if (kind === "enhance") {
  engine.enhance({ data }, width, height, settings);
} else if (kind === "cutout") {
  const vis = engine.floodFill(data, width, height, x, y, thr);
  removed = engine.applyCutout(data, width, height, vis);
}
engine.resetPool();
parentPort.postMessage({ buffer, removed }, [buffer]);
