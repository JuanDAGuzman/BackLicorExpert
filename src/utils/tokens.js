import jwt from "jsonwebtoken";

const isProd = process.env.NODE_ENV === "production";

export function signAccessToken(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_ACCESS_EXPIRES || "15m",
  });
}

export function cookieOpts(ms) {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: isProd,
    path: "/",
    maxAge: ms,
  };
}

export function ttlToMs(ttl = "15m") {
  const m = /^(\d+)([smhd])$/.exec(ttl);
  if (!m) return 15 * 60 * 1000;
  const n = Number(m[1]);
  const u = m[2];
  return u === "s" ? n * 1000 :
         u === "m" ? n * 60 * 1000 :
         u === "h" ? n * 60 * 60 * 1000 :
                     n * 24 * 60 * 60 * 1000;
}
