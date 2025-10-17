import { Router } from "express";
import { q } from "../db.js";

const router = Router();

function ensureFacts(req, res) {
  const { facts } = req.body || {};
  if (!Array.isArray(facts) || facts.length === 0) {
    res.status(400).json({ ok: false, message: "facts (array) requerido" });
    return null;
  }
  return facts;
}

router.post("/recomendar", async (req, res) => {
  try {
    const facts = ensureFacts(req, res);
    if (!facts) return;

    const { userId } = req.body;

    const sql = `
      SELECT * 
      FROM es_eval($1::jsonb, $2::uuid)
      ORDER BY priority ASC, rule_id ASC
      LIMIT 12;
    `;
    const { rows } = await q(sql, [JSON.stringify(facts), userId ?? null]);

    let recomendaciones = [];
    const fallas = { critical: [], warning: [], info: [] };

    for (const r of rows) {
      if (r.action_type === "RECOMENDAR") {
        recomendaciones.push({
          regla: r.name,
          valor: r.action_value,
          prioridad: r.priority,
        });
      } else if (r.action_type === "FALLA") {
        const sev = r.severity || "warning";
        fallas[sev].push({
          regla: r.name,
          valor: r.action_value,
          prioridad: r.priority,
          category: r.category || null,
        });
      }
    }

    function dedupeByValor(list) {
      const seen = new Set();
      const out = [];
      for (const it of list) {
        const key = (it.valor || "").trim().toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          out.push(it);
        }
      }
      return out;
    }

    recomendaciones = dedupeByValor(recomendaciones);
    fallas.critical = dedupeByValor(fallas.critical);
    fallas.warning = dedupeByValor(fallas.warning);
    fallas.info = dedupeByValor(fallas.info);

    let top = null;
    if (recomendaciones.length) {
      top = { ...recomendaciones[0], tipo: "RECOMENDAR" };
    } else if (fallas.critical.length) {
      top = { ...fallas.critical[0], tipo: "FALLA" };
    } else if (fallas.warning.length) {
      top = { ...fallas.warning[0], tipo: "FALLA" };
    } else if (fallas.info.length) {
      top = { ...fallas.info[0], tipo: "FALLA" };
    }

    return res.json({ ok: true, top, recomendaciones, fallas });
  } catch (e) {
    console.error(e);
    return res
      .status(500)
      .json({ ok: false, message: "Error evaluando reglas" });
  }
});

router.post("/eval-pretty", async (req, res) => {
  try {
    const facts = ensureFacts(req, res);
    if (!facts) return;

    const { rows } = await q(`SELECT es_eval_pretty($1::jsonb) AS result`, [
      JSON.stringify(facts),
    ]);

    return res.json(rows[0].result);
  } catch (e) {
    console.error(e);
    return res
      .status(500)
      .json({ ok: false, message: "Error evaluando reglas (pretty)" });
  }
});

export default router;
