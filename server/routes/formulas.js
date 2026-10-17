"use strict";
const crypto = require("crypto");
const express = require("express");
const engine = require("../../public/js/engine.js");
const { HttpError } = require("../util");
const { requireVip } = require("../auth");

const ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789";
function makeCode() {
  const bytes = crypto.randomBytes(8);
  let s = "";
  for (let i = 0; i < 8; i++) s += ALPHABET[bytes[i] % ALPHABET.length];
  return s;
}

module.exports = function formulaRoutes({ db }) {
  const r = express.Router();
  const ins = db.prepare("INSERT INTO formulas (user_id, name, settings, share_code, created_at) VALUES (?, ?, ?, ?, ?)");
  const mine = db.prepare("SELECT * FROM formulas WHERE user_id = ? ORDER BY created_at DESC");
  const byCode = db.prepare("SELECT f.name, f.settings, u.name AS author FROM formulas f JOIN users u ON u.id = f.user_id WHERE f.share_code = ?");
  const del = db.prepare("DELETE FROM formulas WHERE id = ? AND user_id = ?");
  const count = db.prepare("SELECT COUNT(*) AS n FROM formulas WHERE user_id = ?");

  const out = (x) => ({ id: x.id, name: x.name, code: x.share_code, settings: JSON.parse(x.settings), createdAt: x.created_at });

  // Anyone can apply a shared formula, no account needed.
  r.get("/public/:code", (req, res) => {
    const code = String(req.params.code || "").toUpperCase();
    if (!/^[A-Z0-9]{8}$/.test(code)) throw new HttpError(400, "invalid_code", "A formula code has 8 letters and digits.");
    const row = byCode.get(code);
    if (!row) throw new HttpError(404, "not_found", "No formula with that code.");
    res.json({ formula: { name: row.name, author: row.author, settings: engine.sanitize(JSON.parse(row.settings)) } });
  });

  r.get("/", requireVip, (req, res) => {
    res.json({ formulas: mine.all(req.user.id).map(out) });
  });

  r.post("/", requireVip, (req, res) => {
    const b = req.body || {};
    const name = typeof b.name === "string" ? b.name.trim() : "";
    if (!name || name.length > 60) throw new HttpError(400, "invalid_name", "Give the formula a name up to 60 characters.");
    if (count.get(req.user.id).n >= 100) throw new HttpError(409, "formula_limit", "You reached the limit of 100 formulas.");
    const settings = JSON.stringify(engine.sanitize(b.settings));
    let code, id;
    for (let tries = 0; tries < 5; tries++) {
      code = makeCode();
      try { id = ins.run(req.user.id, name, settings, code, Date.now()).lastInsertRowid; break; } catch (_) { id = null; }
    }
    if (!id) throw new HttpError(500, "code_failed", "Could not create a share code. Try again.");
    res.status(201).json({ formula: { id, name, code, settings: JSON.parse(settings) } });
  });

  r.delete("/:id", requireVip, (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || !del.run(id, req.user.id).changes) throw new HttpError(404, "not_found", "Formula not found.");
    res.json({ ok: true });
  });

  return r;
};
