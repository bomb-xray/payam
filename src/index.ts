import http from "http";
import path from "path";
import fs from "fs";
import express from "express";
import { config } from "./config";
import { initBot, handleDeepLink } from "./bot";
import { api } from "./api";
import { initWs } from "./ws";

const ROOT = path.resolve(__dirname, "..");

async function main(): Promise<void> {
  await initBot(handleDeepLink);

  const app = express();
  app.set("trust proxy", true);

  // پوشه آپلود — ساخت اگر نیست
  const uploadDir = path.join(config.dataDir, "uploads");
  fs.mkdirSync(uploadDir, { recursive: true });

  app.use("/api", api);

  // فایل‌های آپلود شده — استاتیک
  app.use("/uploads", express.static(uploadDir, {
    maxAge: "30d",
    setHeaders: (res) => {
      res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    }
  }));

  // کلاینت وب — با کش کوتاه برای index.html تا آپدیت‌ها سریع بیاد
  app.use(express.static(path.join(ROOT, "public"), { maxAge: "1h" }));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(ROOT, "public", "index.html"));
  });

  const server = http.createServer(app);
  initWs(server);

  server.listen(config.port, "0.0.0.0", () => {
    console.log(`✅ پیام‌رسان «Furina mind» بالا آمد: http://0.0.0.0:${config.port}`);
    console.log(`📁 آپلودها: ${uploadDir}`);
  });

  const shutdown = () => {
    console.log("\nدر حال خروج...");
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((e) => {
  console.error("خطای مرگبار:", e);
  process.exit(1);
});
