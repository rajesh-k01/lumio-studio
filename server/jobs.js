"use strict";
const path = require("path");
const { Worker } = require("worker_threads");

const WORKER_FILE = path.join(__dirname, "imageWorker.js");

/* Runs worker jobs with a fixed concurrency; extra jobs wait in a queue. */
function createJobRunner(concurrency) {
  let running = 0;
  const queue = [];

  function start(job) {
    running++;
    const done = () => { running--; if (queue.length) start(queue.shift()); };
    // Copy into a standalone ArrayBuffer so it can be transferred.
    const copy = new Uint8Array(job.data.length);
    copy.set(job.data);
    const worker = new Worker(WORKER_FILE, {
      workerData: Object.assign({}, job.params, { buffer: copy.buffer }),
      transferList: [copy.buffer]
    });
    worker.once("message", (msg) => { done(); job.resolve({ data: Buffer.from(msg.buffer), removed: msg.removed }); });
    worker.once("error", (err) => { done(); job.reject(err); });
    worker.once("exit", (code) => { if (code !== 0) { /* error handler already rejected */ } });
  }

  return function run(data, params) {
    return new Promise((resolve, reject) => {
      const job = { data, params, resolve, reject };
      if (running < concurrency) start(job); else queue.push(job);
    });
  };
}

module.exports = { createJobRunner };
