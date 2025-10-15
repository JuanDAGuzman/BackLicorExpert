import jwt from "jsonwebtoken";

export function authGuard(req, res, next) {
  const cookieToken = req.cookies?.access_token;
  const hdr = req.headers.authorization || "";
  const headerToken = hdr.startsWith("Bearer ") ? hdr.slice(7) : null;

  const token = cookieToken || headerToken;
  if (!token) return res.status(401).json({ ok:false, message:"No autorizado" });

  try {
    const data = jwt.verify(token, process.env.JWT_SECRET);
    req.user = data;
    next();
  } catch {
    return res.status(401).json({ ok:false, message:"Token inválido o expirado" });
  }
}
