import express, { Request, Response, NextFunction } from "express";
import { config } from "./config";
import { botReady, botUsername, sendLoginCode, fetchProfile, handleDeepLink } from "./bot";
import {
  createLoginRequest,
  completeLogin,
  rateLimitOk,
  userByToken,
  revokeSession,
  CODE_TTL_MS,
} from "./auth";
import {
  getAuthCode,
  getUserByTgId,
  getUserById,
  listUsers,
  getHistory,
  markRead,
  updateUserName,
  listSessionsByUser,
  deleteSessionsExcept,
  User,
} from "./db";
import crypto from "crypto";
import { announceUser, notifyUser, isOnline } from "./ws";

export const api = express.Router();
api.use(express.json({ limit: "100kb" }));

function fail(res: Response, status: number, error: string, message?: string): void {
  res.status(status).json({ ok: false, error, message });
}

function bearer(req: Request): string | undefined {
  const h = req.headers.authorization;
  if (h?.startsWith("Bearer ")) return h.slice(7);
  return undefined;
}

function authed(req: Request, res: Response, next: NextFunction): void {
  const user = userByToken(bearer(req));
  if (!user) {
    fail(res, 401, "unauthorized");
    return;
  }
  (req as any).user = user;
  next();
}

function publicUser(u: User, extra: Record<string, unknown> = {}) {
  return {
    id: u.id,
    tg_id: u.tg_id,
    name: u.name,
    username: u.username,
    online: isOnline(u.id),
    last_seen: u.last_seen,
    created_at: u.created_at,
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// عمومی
// ---------------------------------------------------------------------------

api.get("/config", (_req, res) => {
  res.json({ ok: true, app: "Furina mind", bot: botUsername ? `@${botUsername}` : null });
});

// ---------------------------------------------------------------------------
// احراز هویت
// ---------------------------------------------------------------------------

api.post("/auth/request", async (req, res) => {
  try {
    if (!botReady()) return fail(res, 503, "bot_not_ready", "بات هنوز به تلگرام وصل نشده.");

    const raw = String(req.body?.tg_id ?? "").trim();
    const tgId = Number(raw);
    if (!raw || !Number.isInteger(tgId) || tgId <= 0) {
      return fail(
        res,
        400,
        "invalid_id",
        "آی‌دی عددی نامعتبر است. در بات دستور /id را بفرستید تا آی‌دی عددی‌تان را ببینید."
      );
    }

    const ip = req.ip ?? "?";
    if (!rateLimitOk("tg", String(tgId)) || !rateLimitOk("ip", ip)) {
      return fail(res, 429, "rate_limited", "تعداد تلاش زیاد است. چند دقیقه صبر کنید.");
    }

    const { loginToken, code } = createLoginRequest(tgId);
    const sent = await sendLoginCode(tgId, code);
    if (!sent) {
      return fail(
        res,
        400,
        "bot_not_started",
        "ابتدا در تلگرام بات را پیدا کنید و با دکمه‌ی Start فعالش کنید، سپس دوباره امتحان کنید."
      );
    }

    res.json({
      ok: true,
      login_token: loginToken,
      bot: `@${botUsername}`,
      deep_link: `https://t.me/${botUsername}?start=${loginToken}`,
      expires_in: Math.floor(CODE_TTL_MS / 1000),
    });
  } catch (e) {
    console.error("[api] auth/request:", e);
    fail(res, 500, "internal");
  }
});

api.post("/auth/verify", async (req, res) => {
  try {
    const loginToken = String(req.body?.login_token ?? "");
    const code = String(req.body?.code ?? "").trim();
    if (!loginToken || !/^\d{5}$/.test(code)) {
      return fail(res, 400, "bad_input", "کد باید ۵ رقم باشد.");
    }

    const row = getAuthCode(loginToken);
    const isNew = row ? !getUserByTgId(row.tg_id) : false;

    const result = await completeLogin(loginToken, { providedCode: code }, fetchProfile);
    if ("error" in result) {
      const messages: Record<string, string> = {
        not_found: "درخواست ورود پیدا نشد. دوباره از ابتدا شروع کنید.",
        used: "این کد قبلاً استفاده شده است.",
        expired: "کد منقضی شده است. دوباره درخواست دهید.",
        wrong_code: "کد اشتباه است.",
      };
      return fail(res, 400, result.error, messages[result.error]);
    }
    if (isNew) announceUser(result.user);
    res.json({ ok: true, token: result.sessionToken, user: publicUser(result.user) });
  } catch (e) {
    console.error("[api] auth/verify:", e);
    fail(res, 500, "internal");
  }
});

api.get("/auth/status", (req, res) => {
  const loginToken = String(req.query.login_token ?? "");
  const row = loginToken ? getAuthCode(loginToken) : undefined;
  if (!row) return fail(res, 404, "not_found");
  if (row.used && row.session_token) {
    const user = getUserByTgId(row.tg_id);
    if (user) return res.json({ ok: true, done: true, token: row.session_token, user: publicUser(user) });
  }
  if (Date.now() > row.expires_at) return res.json({ ok: true, done: false, expired: true });
  res.json({ ok: true, done: false });
});

// ---------------------------------------------------------------------------
// نیازمند احراز هویت
// ---------------------------------------------------------------------------

api.get("/me", authed, (req, res) => {
  res.json({ ok: true, user: publicUser((req as any).user) });
});

api.post("/logout", authed, (req, res) => {
  revokeSession(bearer(req)!);
  res.json({ ok: true });
});

api.get("/users", authed, (req, res) => {
  const me: User = (req as any).user;
  res.json({
    ok: true,
    users: listUsers().filter((u) => u.id !== me.id).map((u) => publicUser(u)),
  });
});

api.put("/me", authed, (req, res) => {
  const me: User = (req as any).user;
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  if (!name || name.length < 2 || name.length > 64) {
    return fail(res, 400, "bad_name", "نام باید بین ۲ تا ۶۴ کاراکتر باشد.");
  }
  const updated = updateUserName(me.id, name);
  if (!updated) return fail(res, 400, "bad_name", "نام نامعتبر است.");
  // به همه اطلاع بده نام عوض شده
  announceUser(updated);
  res.json({ ok: true, user: publicUser(updated) });
});

api.get("/sessions", authed, (req, res) => {
  const me: User = (req as any).user;
  const token = bearer(req);
  const curHash = token ? crypto.createHash("sha256").update(token).digest("hex") : "";
  const sessions = listSessionsByUser(me.id).map((s) => ({
    id: s.token_hash,
    current: s.token_hash === curHash,
    created_at: s.created_at,
    preview: s.token_hash.slice(0, 12),
  }));
  res.json({ ok: true, sessions });
});

api.post("/sessions/revoke-others", authed, (req, res) => {
  const me: User = (req as any).user;
  const token = bearer(req);
  if (!token) return fail(res, 401, "unauthorized");
  const curHash = crypto.createHash("sha256").update(token).digest("hex");
  const count = deleteSessionsExcept(me.id, curHash);
  res.json({ ok: true, revoked: count });
});

api.get("/messages", authed, (req, res) => {
  const me: User = (req as any).user;
  const peerId = Number(req.query.with);
  const peer = peerId ? getUserById(peerId) : undefined;
  if (!peer) return fail(res, 404, "no_peer", "چنین کاربری وجود ندارد.");

  const messages = getHistory(me.id, peer.id, 200);
  const changed = markRead(me.id, peer.id);
  if (changed > 0) notifyUser(peer.id, { t: "read", by: me.id });
  res.json({ ok: true, messages });
});

/** وب‌هوک داخلی نیست؛ دیپ‌لینک بات این‌جا استفاده نمی‌شود ولی برای تست دستی نگه داشته شده */
api.get("/health", (_req, res) => {
  res.json({ ok: true, bot: botReady() ? "ready" : "connecting", uptime: process.uptime() });
});

export { handleDeepLink };
