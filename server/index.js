"use strict";
const { loadConfig } = require("./config");
const { openDb } = require("./db");
const { createApp } = require("./app");

const cfg = loadConfig();
const db = openDb(cfg.dbFile);
const { app, sessions } = createApp(cfg, db);

const server = app.listen(cfg.port, () => {
  console.log("Lumio Studio running at http://localhost:" + cfg.port);
  console.log("VIP policy: " + cfg.vipPolicy + (cfg.vipPolicy === "auto" ? " (signing up unlocks VIP)" : " (users must claim VIP)"));
  console.log("Database: " + cfg.dbFile);
  if (cfg.aiWorker) console.log("Neural upscaling: enabled");
});

const cleaner = setInterval(() => sessions.purgeExpired(), 60 * 60 * 1000);
cleaner.unref();

function shutdown() {
  console.log("Shutting down");
  clearInterval(cleaner);
  server.close(() => { try { db.close(); } catch (_) { /* already closed */ } process.exit(0); });
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
