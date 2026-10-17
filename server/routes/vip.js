"use strict";
const express = require("express");
const { requireAuth, publicUser } = require("../auth");

/* Claiming VIP is free for any signed-in user. With LUMIO_VIP_POLICY=auto this is done at sign-up. */
module.exports = function vipRoutes({ db }) {
  const r = express.Router();
  const setVip = db.prepare("UPDATE users SET tier = 'vip', vip_since = COALESCE(vip_since, ?) WHERE id = ?");
  const getUser = db.prepare("SELECT id, email, name, tier, vip_since FROM users WHERE id = ?");

  r.post("/claim", requireAuth, (req, res) => {
    setVip.run(Date.now(), req.user.id);
    res.json({ user: publicUser(getUser.get(req.user.id)) });
  });

  return r;
};
