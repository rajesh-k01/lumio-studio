"use strict";
const crypto = require("crypto");
const { promisify } = require("util");
const { HttpError, parseCookies } = require("./util");

const scrypt = promisify(crypto.scrypt);
const COOKIE = "lumio_session";

/* ---------- passwords: scrypt with a random salt, stored as scrypt$N$r$p$salt$hash ---------- */
async function hashPassword(password, N) {
  const salt = crypto.randomBytes(16);
  const r = 8, p = 1;
  const key = await scrypt(password, salt, 64, { N, r, p, maxmem: 128 * N * r * 2 });
  return ["scrypt", N, r, p, salt.toString("base64"), key.toString("base64")].join("$");
}

async function verifyPassword(password, stored) {
  const parts = String(stored).split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const N = Number(parts[1]), r = Number(parts[2]), p = Number(parts[3]);
  const salt = Buffer.from(parts[4], "base64");
  const expected = Buffer.from(parts[5], "base64");
  const key = await scrypt(password, salt, expected.length, { N, r, p, maxmem: 128 * N * r * 2 });
  return crypto.timingSafeEqual(key, expected);
}

/* ---------- sessions: random token in an httpOnly cookie, only its hash is stored ---------- */
const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");

function publicUser(row) {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    tier: row.tier,
    vip: row.tier === "vip",
    vipSince: row.vip_since || null
  };
}

function createSessionStore(db, cfg) {
  const insert = db.prepare("INSERT INTO sessions (token_hash, user_id, created_at, expires_at, agent) VALUES (?, ?, ?, ?, ?)");
  const find = db.prepare(
    "SELECT u.id, u.email, u.name, u.tier, u.vip_since FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?"
  );
  const del = db.prepare("DELETE FROM sessions WHERE token_hash = ?");
  const purge = db.prepare("DELETE FROM sessions WHERE expires_at <= ?");

  return {
    create(res, userId, req) {
      const token = crypto.randomBytes(32).toString("base64url");
      const ttl = cfg.sessionDays * 86400 * 1000;
      insert.run(sha256(token), userId, Date.now(), Date.now() + ttl, String(req.headers["user-agent"] || "").slice(0, 200));
      const flags = ["HttpOnly", "SameSite=Lax", "Path=/", "Max-Age=" + cfg.sessionDays * 86400];
      if (cfg.cookieSecure || req.secure) flags.push("Secure");
      res.append("Set-Cookie", COOKIE + "=" + token + "; " + flags.join("; "));
    },
    destroy(req, res) {
      const t = parseCookies(req.headers.cookie)[COOKIE];
      if (t) del.run(sha256(t));
      res.append("Set-Cookie", COOKIE + "=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
    },
    purgeExpired() { purge.run(Date.now()); },
    middleware() {
      return (req, res, next) => {
        req.user = null;
        const t = parseCookies(req.headers.cookie)[COOKIE];
        if (t) {
          const row = find.get(sha256(t), Date.now());
          if (row) req.user = publicUser(row);
        }
        next();
      };
    }
  };
}

/* ---------- guards ---------- */
function requireAuth(req, res, next) {
  if (!req.user) return next(new HttpError(401, "auth_required", "Sign in to use this feature."));
  next();
}
function requireVip(req, res, next) {
  if (!req.user) return next(new HttpError(401, "auth_required", "Sign in to claim free VIP and use this feature."));
  if (!req.user.vip) return next(new HttpError(403, "vip_required", "Claim your free VIP to use this feature."));
  next();
}

/* Cross-site forms cannot set custom headers, so requiring one blocks CSRF on cookie sessions. */
function csrfGuard(req, res, next) {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return next();
  if (req.get("x-requested-with") !== "lumio") return next(new HttpError(403, "csrf", "Missing X-Requested-With header."));
  next();
}

module.exports = { hashPassword, verifyPassword, createSessionStore, requireAuth, requireVip, csrfGuard, publicUser, COOKIE };
