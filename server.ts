import "dotenv/config";
import express from "express";
import path from "path";
import { config as loadEnv } from "dotenv";
import { createServer as createViteServer } from "vite";

loadEnv({ path: path.join(process.cwd(), ".env.local"), override: true });

function normalizeEnvValue(v: string | undefined): string {
  if (v == null) return "";
  const t = v.trim();
  if (
    (t.startsWith('"') && t.endsWith('"')) ||
    (t.startsWith("'") && t.endsWith("'"))
  ) {
    return t.slice(1, -1).trim();
  }
  return t;
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(express.json({ limit: "32mb" }));

  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  app.post("/api/llmost/chat/completions", async (req, res) => {
    try {
      const base = (process.env.LLMOST_BASE_URL || "https://llmost.ru/api/v1").replace(
        /\/$/,
        ""
      );
      const key =
        normalizeEnvValue(process.env.LLMOST_API_KEY) ||
        normalizeEnvValue(process.env.GEMINI_API_KEY);
      if (!key) {
        return res.status(500).json({
          error: {
            message:
              "Задайте LLMOST_API_KEY или GEMINI_API_KEY в .env.local на сервере (Bearer для llmost.ru).",
          },
        });
      }
      const upstream = await fetch(`${base}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(req.body),
      });
      const text = await upstream.text();
      res.status(upstream.status).type("application/json").send(text);
    } catch (e) {
      res.status(500).json({ error: { message: String(e) } });
    }
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
