"use strict";
const express = require("express");
const sharp = require("sharp");
const engine = require("../../public/js/engine.js");
const { HttpError, wrap } = require("../util");
const { requireVip } = require("../auth");

const THUMB_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;

function cleanName(v) {
  const s = typeof v === "string" ? v.trim() : "";
  if (!s || s.length > 80) throw new HttpError(400, "invalid_name", "Give the project a name up to 80 characters.");
  return s;
}
function cleanMode(v) { return v === "video" ? "video" : "photo"; }
function cleanThumb(v) {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string" || v.length > 120000 || !THUMB_RE.test(v)) throw new HttpError(400, "invalid_thumb", "Thumbnail must be a JPEG, PNG or WebP data URL under 120 KB.");
  return v;
}
function rowOut(r, withSettings) {
  const o = { id: r.id, name: r.name, mode: r.mode, thumb: r.thumb || null, hasImage: !!r.has_image, createdAt: r.created_at, updatedAt: r.updated_at };
  if (withSettings) o.settings = JSON.parse(r.settings);
  return o;
}

module.exports = function projectRoutes({ db, cfg }) {
  const r = express.Router();
  r.use(requireVip);

  const list = db.prepare("SELECT * FROM projects WHERE user_id = ? ORDER BY updated_at DESC");
  const count = db.prepare("SELECT COUNT(*) AS n FROM projects WHERE user_id = ?");
  const one = db.prepare("SELECT * FROM projects WHERE id = ? AND user_id = ?");
  const ins = db.prepare("INSERT INTO projects (user_id, name, mode, settings, thumb, has_image, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?)");
  const upd = db.prepare("UPDATE projects SET name = ?, mode = ?, settings = ?, thumb = ?, updated_at = ? WHERE id = ? AND user_id = ?");
  const del = db.prepare("DELETE FROM projects WHERE id = ? AND user_id = ?");
  const usage = db.prepare("SELECT COALESCE(SUM(f.size), 0) AS bytes FROM project_files f JOIN projects p ON p.id = f.project_id WHERE p.user_id = ?");
  const fileSize = db.prepare("SELECT size FROM project_files WHERE project_id = ?");
  const putFile = db.prepare("INSERT INTO project_files (project_id, mime, size, data) VALUES (?, ?, ?, ?) ON CONFLICT(project_id) DO UPDATE SET mime = excluded.mime, size = excluded.size, data = excluded.data");
  const getFile = db.prepare("SELECT mime, data FROM project_files WHERE project_id = ?");
  const markImage = db.prepare("UPDATE projects SET has_image = 1, updated_at = ? WHERE id = ?");

  function mine(req) {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw new HttpError(404, "not_found", "Project not found.");
    const row = one.get(id, req.user.id);
    if (!row) throw new HttpError(404, "not_found", "Project not found.");
    return row;
  }

  r.get("/", (req, res) => {
    res.json({ projects: list.all(req.user.id).map((x) => rowOut(x, false)), usageBytes: usage.get(req.user.id).bytes, quotaBytes: cfg.userQuotaBytes });
  });

  r.post("/", (req, res) => {
    const b = req.body || {};
    if (count.get(req.user.id).n >= cfg.maxProjects) throw new HttpError(409, "project_limit", "You reached the limit of " + cfg.maxProjects + " projects. Delete one first.");
    const now = Date.now();
    const settings = JSON.stringify(engine.sanitize(b.settings));
    const id = ins.run(req.user.id, cleanName(b.name), cleanMode(b.mode), settings, cleanThumb(b.thumb), now, now).lastInsertRowid;
    res.status(201).json({ project: rowOut(one.get(id, req.user.id), true) });
  });

  r.get("/:id", (req, res) => {
    res.json({ project: rowOut(mine(req), true) });
  });

  r.put("/:id", (req, res) => {
    const row = mine(req), b = req.body || {};
    const name = b.name === undefined ? row.name : cleanName(b.name);
    const mode = b.mode === undefined ? row.mode : cleanMode(b.mode);
    const settings = b.settings === undefined ? row.settings : JSON.stringify(engine.sanitize(b.settings));
    const thumb = b.thumb === undefined ? row.thumb : cleanThumb(b.thumb);
    upd.run(name, mode, settings, thumb, Date.now(), row.id, req.user.id);
    res.json({ project: rowOut(one.get(row.id, req.user.id), true) });
  });

  r.delete("/:id", (req, res) => {
    const row = mine(req);
    del.run(row.id, req.user.id);
    res.json({ ok: true });
  });

  r.put("/:id/image", express.raw({ type: () => true, limit: cfg.maxUploadBytes }), wrap(async (req, res) => {
    const row = mine(req);
    const mime = String(req.get("content-type") || "").split(";")[0].trim();
    if (!/^image\/(png|jpeg|webp)$/.test(mime)) throw new HttpError(415, "unsupported_type", "Upload a PNG, JPEG or WebP image.");
    const body = req.body;
    if (!Buffer.isBuffer(body) || !body.length) throw new HttpError(400, "empty_body", "The image body is empty.");
    try { await sharp(body, { limitInputPixels: cfg.maxInputPixels }).metadata(); }
    catch (_) { throw new HttpError(400, "invalid_image", "That file is not a readable image."); }
    const prev = fileSize.get(row.id);
    const used = usage.get(req.user.id).bytes - (prev ? prev.size : 0);
    if (used + body.length > cfg.userQuotaBytes) throw new HttpError(413, "quota_exceeded", "Your cloud storage is full. Delete a project to free space.");
    putFile.run(row.id, mime, body.length, body);
    markImage.run(Date.now(), row.id);
    res.json({ ok: true, size: body.length });
  }));

  r.get("/:id/image", (req, res) => {
    const row = mine(req);
    const f = getFile.get(row.id);
    if (!f) throw new HttpError(404, "no_image", "This project has no saved image.");
    res.set("Content-Type", f.mime);
    res.set("Cache-Control", "private, no-store");
    res.send(Buffer.from(f.data));
  });

  return r;
};
