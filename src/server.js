import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import dotenv from "dotenv";
import authRoutes from "./routes/auth.routes.js";
import catalogRoutes from "./routes/catalog.routes.js";
import { authGuard } from "./middlewares/authGuard.js";
import preferencesRoutes from "./routes/preferences.routes.js";
import { q } from "./db.js";
import expertRoutes from "./routes/expert.routes.js";


dotenv.config();
const app = express();

app.use(
  cors({
    origin: "http://localhost:5173",
    credentials: true,
  })
);
app.use(express.json());
app.use(cookieParser());

app.get("/", (_req, res) => res.send("API OK"));

app.use("/auth", authRoutes);
app.use("/catalog", catalogRoutes);
app.use("/preferences", preferencesRoutes);
app.use("/expert", expertRoutes);

app.get("/me", authGuard, async (req, res) => {
  const { rows } = await q(
    "SELECT id, email, display_name, favorite_base, created_at FROM users WHERE id=$1",
    [req.user.id]
  );
  if (!rows.length)
    return res.status(404).json({ ok: false, message: "No encontrado" });
  res.json({ ok: true, user: rows[0] });
});

const port = process.env.PORT || 4000;
app.listen(port, () => console.log(`API on :${port}`));
