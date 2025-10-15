import crypto from "crypto";

export function sha256(s) {
  return crypto.createHash("sha256").update(String(s)).digest("hex");
}
