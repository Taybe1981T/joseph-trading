import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import fs from "fs";
import apiApp from "./api/server.ts";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Global request logger
  app.use((req, res, next) => {
    console.log(`[Request] ${req.method} ${req.url}`);
    next();
  });

  app.use(express.json());
  console.log("[Server] Initializing Finalyze Engine...");

  // Mount API endpoints from api/server.ts (the same file Vercel serves via the
  // /api/(.*) rewrite). api/index.ts was an older, partial copy without
  // /api/quote or /api/quotes — the live-price routes the UI depends on.
  app.use(apiApp);

  // API Route: Health check
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", version: "4.0-Institutional", node: process.version });
  });

  const distPath = path.resolve(process.cwd(), "dist");
  const isProd = process.env.NODE_ENV === "production";

  if (isProd && fs.existsSync(distPath)) {
    console.log("[Server] Production mode: Serving static files from /dist");
    app.use(express.static(distPath, { etag: false })); // Disable Etag to force refresh
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  } else {
    console.log("[Server] Development mode: Starting Vite middleware");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`🚀 Finalyze AI is LIVE at: http://localhost:${PORT}`);
  });
}

startServer().catch(err => {
  console.error("Critical Server Crash:", err);
  process.exit(1);
});
