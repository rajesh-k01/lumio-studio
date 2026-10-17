"use strict";
const express = require("express");
const { HttpError, wrap, isEmail } = require("../util");
const { hashPassword, verifyPassword, requireAuth, publicUser } = require("../auth");
const { rateLimit } = require("../ratelimit");

module.exports = function authRoutes({ db, cfg, sessions }) {
  const r = express.Router();
  const limiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 30 });

  const byEmail = db.prepare("SELECT * FROM users WHERE email = ?");
  const insertUser = db.prepare("INSERT INTO users (email, name, pass_hash, tier, vip_since, created_at) VALUES (?, ?, ?, ?, ?, ?)");
  const getUser = db.prepare("SELECT id, email, name, tier, vip_since FROM users WHERE id = ?");
  const delUser = db.prepare("DELETE FROM users WHERE id = ?");

  r.post("/register", limiter, wrap(async (req, res) => {
    const { name, email, password } = req.body || {};
    const cleanName = typeof name === "string" ? name.trim() : "";
    if (!cleanName || cleanName.length > 60) throw new HttpError(400, "invalid_name", "Enter a name up to 60 characters.");
    if (!isEmail(email)) throw new HttpError(400, "invalid_email", "Enter a valid email address.");
    if (typeof password !== "string" || password.length < 8 || password.length > 200) {
      throw new HttpError(400, "invalid_password", "Use a password of at least 8 characters.");
    }
    if (byEmail.get(email)) throw new HttpError(409, "email_taken", "An account with this email already exists. Sign in instead.");
    const hash = await hashPassword(password, cfg.scryptN);
    const now = Date.now();
    const auto = cfg.vipPolicy === "auto";
    let id;
    try {
      id = insertUser.run(email.trim(), cleanName, hash, auto ? "vip" : "free", auto ? now : null, now).lastInsertRowid;
    } catch (e) {
      throw new HttpError(409, "email_taken", "An account with this email already exists. Sign in instead.");
    }
    sessions.create(res, id, req);
    res.status(201).json({ user: publicUser(getUser.get(id)) });
  }));

  r.post("/login", limiter, wrap(async (req, res) => {
    const { email, password } = req.body || {};
    if (!isEmail(email) || typeof password !== "string" || !password) {
      throw new HttpError(400, "invalid_credentials", "Enter your email and password.");
    }
    const row = byEmail.get(email.trim());
    // Always run a hash comparison so timing does not reveal whether the email exists.
    const ok = await verifyPassword(password, row ? row.pass_hash : "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$" + Buffer.alloc(64).toString("base64"));
    if (!row || !ok) throw new HttpError(401, "wrong_credentials", "Wrong email or password.");
    sessions.create(res, row.id, req);
    res.json({ user: publicUser(getUser.get(row.id)) });
  }));

  r.post("/logout", (req, res) => {
    sessions.destroy(req, res);
    res.json({ ok: true });
  });

  r.get("/me", (req, res) => {
    res.json({ user: req.user });
  });

  r.delete("/account", requireAuth, wrap(async (req, res) => {
    const { password } = req.body || {};
    const row = byEmail.get(req.user.email);
    if (typeof password !== "string" || !(await verifyPassword(password, row.pass_hash))) {
      throw new HttpError(401, "wrong_credentials", "Wrong password.");
    }
    delUser.run(req.user.id);
    sessions.destroy(req, res);
    res.json({ ok: true });
  }));

  return r;
};
