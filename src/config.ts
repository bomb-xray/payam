import fs from "fs";
import path from "path";

/** بارگذاری فایل .env بدون وابستگی اضافه */
function loadDotEnv(file: string): void {
  try {
    const txt = fs.readFileSync(file, "utf8");
    for (const line of txt.split("\n")) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      let val = m[2].trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (!(m[1] in process.env)) process.env[m[1]] = val;
    }
  } catch {
    /* فایل .env اختیاری است */
  }
}

loadDotEnv(path.join(process.cwd(), ".env"));

export interface Config {
  botToken: string;
  port: number;
  dataDir: string;
}

export const config: Config = {
  botToken: process.env.BOT_TOKEN ?? "",
  port: Number(process.env.PORT ?? 3000),
  dataDir: process.env.DATA_DIR ?? path.join(process.cwd(), "data"),
};
