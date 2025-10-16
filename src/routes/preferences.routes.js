import express from "express";
import { q } from "../db.js";

const router = express.Router();

// POST /api/preferences → guarda las preferencias del usuario
router.post("/", async (req, res) => {
  try {
    const { nombre, sabor, con_alcohol} = req.body;

    // Validaciones básicas
    if (!nombre || !sabor) {
      return res
        .status(400)
        .json({ ok: false, message: "Faltan campos obligatorios" });
    }

    // Insertar en la base de datos
    const query = `
      INSERT INTO user_preferences (nombre, sabor, con_alcohol)
      VALUES ($1, $2, $3)
      RETURNING *;
    `;
    const values = [nombre, sabor, con_alcohol];
    const { rows } = await q(query, values);

    res.status(201).json({
      ok: true,
      message: "Preferencias guardadas correctamente",
      data: rows[0],
    });
  } catch (error) {
    console.error("❌ Error al guardar preferencias:", error);
    res.status(500).json({ ok: false, message: "Error interno del servidor" });
  }
});

export default router;
