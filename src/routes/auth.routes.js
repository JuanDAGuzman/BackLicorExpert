import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import dayjs from "dayjs";
import { v4 as uuidv4 } from "uuid";
import { q } from "../db.js";
import { RegisterSchema, LoginSchema } from "../validators/schemas.js";
import { signAccessToken, cookieOpts, ttlToMs } from "../utils/tokens.js";
import { sha256 } from "../utils/crypto.js";
import { authGuard } from "../middlewares/authGuard.js";

const router = Router();

function clearAuthCookies(res) {
  res.clearCookie("access_token", { path: "/" });
  res.clearCookie("refresh_token", { path: "/" });
}

function setAccessCookie(res, payload) {
  const accessTtl = process.env.JWT_ACCESS_EXPIRES || "15m";
  const access = signAccessToken(payload);
  res.cookie("access_token", access, cookieOpts(ttlToMs(accessTtl)));
}


async function issueSessionCookies(res, user, userAgent, ip) {
  const refreshTtl = process.env.JWT_REFRESH_EXPIRES || "7d";
  const accessTtl = process.env.JWT_ACCESS_EXPIRES || "15m";

  const jti = uuidv4();
  const ver = user.token_version || 0;

  const refresh = jwt.sign(
    { id: user.id, email: user.email, ver, jti },
    process.env.JWT_SECRET,
    { expiresIn: refreshTtl }
  );

  const expiresAt = dayjs().add(ttlToMs(refreshTtl), "millisecond").toDate();
  await q(
    `INSERT INTO refresh_tokens(user_id, jti, token_hash, user_agent, ip, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [user.id, jti, sha256(refresh), userAgent || null, ip || null, expiresAt]
  );

  res.cookie("refresh_token", refresh, cookieOpts(ttlToMs(refreshTtl)));
  const access = signAccessToken({ id: user.id, email: user.email });
  res.cookie("access_token", access, cookieOpts(ttlToMs(accessTtl)));
}

router.post("/register", async (req, res) => {
  try {
    const body = RegisterSchema.parse(req.body);

    const exists = await q("SELECT 1 FROM users WHERE email=$1", [body.email]);
    if (exists.rowCount)
      return res
        .status(409)
        .json({ ok: false, message: "Email ya registrado" });

    const hash = await bcrypt.hash(body.password, 10);

    const { rows } = await q(
      `INSERT INTO users(email, password_hash, display_name, favorite_base)
       VALUES ($1,$2,$3,$4)
       RETURNING id, email, display_name, favorite_base, created_at, token_version`,
      [body.email, hash, body.display_name, body.favorite_base]
    );

    const user = rows[0];
    const ua = req.get("user-agent");
    const ip = req.ip;

    await issueSessionCookies(res, user, ua, ip);

    return res.status(201).json({ ok: true, user });
  } catch (err) {
    if (err?.issues)
      return res
        .status(400)
        .json({ ok: false, message: err.issues[0].message });
    return res.status(500).json({ ok: false, message: "Error de servidor" });
  }
});

router.post("/login", async (req, res) => {
  try {
    const { email, password } = LoginSchema.parse(req.body);

    const { rows } = await q("SELECT * FROM users WHERE email=$1", [email]);
    if (!rows.length)
      return res
        .status(401)
        .json({ ok: false, message: "Credenciales inválidas" });

    const u = rows[0];
    const ok = await bcrypt.compare(password, u.password_hash);
    if (!ok)
      return res
        .status(401)
        .json({ ok: false, message: "Credenciales inválidas" });

    const ua = req.get("user-agent");
    const ip = req.ip;
    await issueSessionCookies(res, u, ua, ip);

    return res.json({
      ok: true,
      user: {
        id: u.id,
        email: u.email,
        display_name: u.display_name,
        favorite_base: u.favorite_base,
        created_at: u.created_at,
      },
    });
  } catch (err) {
    if (err?.issues)
      return res
        .status(400)
        .json({ ok: false, message: err.issues[0].message });
    return res.status(500).json({ ok: false, message: "Error de servidor" });
  }
});

router.post("/refresh", async (req, res) => {
  const rt = req.cookies?.refresh_token;
  if (!rt)
    return res.status(401).json({ ok: false, message: "Sin refresh token" });

  try {
    const payload = jwt.verify(rt, process.env.JWT_SECRET); 

    const { rows } = await q(
      `SELECT rt.*, u.token_version
         FROM refresh_tokens rt
         JOIN users u ON u.id = rt.user_id
        WHERE rt.jti = $1 AND rt.user_id = $2`,
      [payload.jti, payload.id]
    );
    if (!rows.length) throw new Error("Refresh no registrado");
    const rec = rows[0];

    if (rec.revoked_at) throw new Error("Refresh revocado");
    if (sha256(rt) !== rec.token_hash) throw new Error("Hash mismatch");
    if (new Date(rec.expires_at) < new Date())
      throw new Error("Refresh expirado");
    if ((rec.token_version ?? 0) !== (payload.ver ?? 0))
      throw new Error("Versión inválida");

    setAccessCookie(res, { id: payload.id, email: payload.email });


    return res.json({ ok: true, rotated: false });
  } catch (e) {
    clearAuthCookies(res);
    return res
      .status(401)
      .json({ ok: false, message: "Refresh inválido o expirado" });
  }
});

router.post("/logout", async (req, res) => {
  const rt = req.cookies?.refresh_token;
  if (rt) {
    try {
      const p = jwt.verify(rt, process.env.JWT_SECRET);
      await q(
        `UPDATE refresh_tokens
            SET revoked_at = NOW()
          WHERE user_id = $1 AND jti = $2 AND token_hash = $3 AND revoked_at IS NULL`,
        [p.id, p.jti, sha256(rt)]
      );
    } catch (e) {
    }
  }
  clearAuthCookies(res);
  res.json({ ok: true });
});

router.post("/logout_all", authGuard, async (req, res) => {
  await q("UPDATE users SET token_version = token_version + 1 WHERE id = $1", [
    req.user.id,
  ]);
  await q(
    "UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL",
    [req.user.id]
  );
  clearAuthCookies(res);
  res.json({ ok: true });
});

router.get("/whoami", authGuard, (req, res) => {
  res.json({ ok: true, user: req.user });
});

export default router;
