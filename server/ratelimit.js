"use strict";
const { HttpError } = require("./util");

/* Small in-memory sliding-window limiter. For several server instances use a shared store instead. */
function rateLimit({ windowMs, max, key }) {
  const hits = new Map();
  const timer = setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [k, arr] of hits) {
      const kept = arr.filter((t) => t > cutoff);
      if (kept.length) hits.set(k, kept); else hits.delete(k);
    }
  }, Math.max(1000, windowMs));
  timer.unref();

  return function (req, res, next) {
    const k = key ? key(req) : req.ip;
    const now = Date.now();
    const arr = (hits.get(k) || []).filter((t) => t > now - windowMs);
    if (arr.length >= max) {
      const retry = Math.ceil((arr[0] + windowMs - now) / 1000);
      res.set("Retry-After", String(retry));
      return next(new HttpError(429, "rate_limited", "Too many requests. Try again in " + retry + " seconds."));
    }
    arr.push(now);
    hits.set(k, arr);
    next();
  };
}

module.exports = { rateLimit };
