import { Router } from "express";
import { q } from "../db.js";

const router = Router();

router.get("/bases", async (_req, res) => {
  try {
    const { rows } = await q(
      "SELECT code, label FROM liquor_bases ORDER BY label"
    );
    res.json({ ok: true, items: rows });
  } catch (e) {
    res.status(500).json({ ok:false, message:"Error consultando catálogo" });
  }
});

export default router;
