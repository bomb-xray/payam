import express, { Request, Response, NextFunction } from "express";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import multer from "multer";
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
  getRelevantUsers,
  getHistory,
  getGroupHistory,
  markRead,
  updateUserProfile,
  listSessionsByUser,
  deleteSessionsExcept,
  getLastMessages,
  getAllMessagesForUser,
  insertMessage,
  insertGroupMessage,
  listContacts,
  addContact,
  deleteContact,
  createGroup,
  getGroupById,
  listGroupsForUser,
  getGroupMembers,
  addGroupMember,
  removeGroupMember,
  isGroupMember,
  getGroupByInvite,
  updateGroupInfo,
  unreadGroupCounts,
  User,
} from "./db";
import { announceUser, notifyUser, isOnline, broadcastGroup } from "./ws";

export const api = express.Router();
api.use(express.json({ limit: "500kb" }));

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
    bio: (u as any).bio || "",
    avatar_url: (u as any).avatar_url || null,
    online: isOnline(u.id),
    last_seen: u.last_seen,
    created_at: u.created_at,
    ...extra,
  };
}

function needsOnboarding(u: User): boolean {
  // اگر یوزرنیم نداره یا بایو خالیه و تازه ساخته شده (کمتر از 1 روز) — برای بار اول
  const hasUsername = !!(u.username && String(u.username).trim().length >= 3);
  const hasBio = !!((u as any).bio && String((u as any).bio).trim().length > 0);
  const isNew = Date.now() - u.created_at < 5 * 60 * 1000; // 5 دقیقه اول
  return (!hasUsername || !hasBio) && isNew;
}

// ---------------------------------------------------------------------------
// آپلود فایل — multer
// ---------------------------------------------------------------------------
const uploadDir = path.join(config.dataDir, "uploads");
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).slice(0, 10);
    const name = crypto.randomBytes(12).toString("hex") + ext;
    cb(null, name);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB
  fileFilter: (_req, _file, cb) => cb(null, true),
});

function detectFileType(mime: string, filename: string): string {
  if (mime.startsWith("image/")) {
    if (mime === "image/gif" || filename.toLowerCase().endsWith(".gif")) return "gif";
    return "image";
  }
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "voice";
  return "file";
}

// ---------------------------------------------------------------------------
// عمومی
// ---------------------------------------------------------------------------
api.get("/config", (_req, res) => {
  res.json({ ok: true, app: "Furina mind", bot: botUsername ? `@${botUsername}` : null, proto: "ws/tcp+deflate" });
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
      return fail(res, 400, "invalid_id", "آی‌دی عددی نامعتبر است. در بات دستور /id را بفرستید.");
    }
    const ip = req.ip ?? "?";
    if (!rateLimitOk("tg", String(tgId)) || !rateLimitOk("ip", ip)) {
      return fail(res, 429, "rate_limited", "تعداد تلاش زیاد است.");
    }
    const { loginToken, code } = createLoginRequest(tgId);
    const sent = await sendLoginCode(tgId, code);
    if (!sent) {
      return fail(res, 400, "bot_not_started", "ابتدا در تلگرام بات را استارت کنید.");
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
        not_found: "درخواست ورود پیدا نشد.",
        used: "این کد قبلاً استفاده شده.",
        expired: "کد منقضی شده.",
        wrong_code: "کد اشتباه است.",
      };
      return fail(res, 400, result.error, messages[result.error]);
    }
    // برای کاربر جدید، آنونس نمی‌کنیم به همه — فقط به مخاطبینش بعداً نشون داده میشه (حریم)
    // if (isNew) announceUser(result.user);
    const pu = publicUser(result.user, { needs_onboarding: isNew || needsOnboarding(result.user) });
    res.json({ ok: true, token: result.sessionToken, user: pu, is_new: isNew });
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
// کاربر
// ---------------------------------------------------------------------------
api.get("/me", authed, (req, res) => {
  const me = (req as any).user as User;
  const fresh = getUserById(me.id) || me;
  res.json({ ok: true, user: publicUser(fresh, { needs_onboarding: needsOnboarding(fresh) }) });
});

api.post("/logout", authed, (req, res) => {
  revokeSession(bearer(req)!);
  res.json({ ok: true });
});

// لیست مرتبط — فقط مخاطبین، چت‌ شده‌ها، هم‌گروهی‌ها — نه همه کاربران (حریم خصوصی)
api.get("/users", authed, (req, res) => {
  const me = (req as any).user as User;
  const relevant = getRelevantUsers(me.id);
  res.json({ ok: true, users: relevant.map((u) => publicUser(u)) });
});

// پروفایل عمومی کاربر دیگر — با کلیک روی آواتار
api.get("/users/:id", authed, (req, res) => {
  const id = Number(req.params.id);
  const u = getUserById(id);
  if (!u) return fail(res, 404, "not_found");
  // بیو و ... فقط اگر مخاطب یا هم‌گروهی یا چت داشته — برای حریم، فعلاً همه لاگین کرده‌ها می‌بینند ولی لیست کاربران محدوده
  res.json({ ok: true, user: publicUser(u) });
});

api.put("/me", authed, (req, res) => {
  const me = (req as any).user as User;
  const { name, username, bio } = req.body ?? {};
  try {
    const fields: any = {};
    if (name !== undefined) fields.name = String(name);
    if (username !== undefined) fields.username = username ? String(username) : null;
    if (bio !== undefined) fields.bio = String(bio);
    const updated = updateUserProfile(me.id, fields);
    if (!updated) return fail(res, 400, "bad_input");
    announceUser(updated);
    res.json({ ok: true, user: publicUser(updated) });
  } catch (e: any) {
    if (e.message === "username_taken") return fail(res, 400, "username_taken", "این یوزرنیم قبلاً گرفته شده.");
    if (e.message === "username_bad_format") return fail(res, 400, "username_bad_format", "یوزرنیم باید 3-32 حرف و شامل a-z 0-9 _ باشد.");
    throw e;
  }
});

// آپلود فایل — عکس، ویدیو، گیف، هر فایلی
api.post("/upload", authed, upload.single("file"), (req, res) => {
  const file = (req as any).file as Express.Multer.File | undefined;
  if (!file) return fail(res, 400, "no_file", "فایلی ارسال نشد.");
  const type = detectFileType(file.mimetype, file.originalname);
  const url = `/uploads/${file.filename}`;
  res.json({
    ok: true,
    file: {
      url,
      name: file.originalname,
      size: file.size,
      mime: file.mimetype,
      type,
    },
  });
});

// ---------------------------------------------------------------------------
// سشن‌ها
// ---------------------------------------------------------------------------
api.get("/sessions", authed, (req, res) => {
  const me = (req as any).user as User;
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
  const me = (req as any).user as User;
  const token = bearer(req);
  if (!token) return fail(res, 401, "unauthorized");
  const curHash = crypto.createHash("sha256").update(token).digest("hex");
  const count = deleteSessionsExcept(me.id, curHash);
  res.json({ ok: true, revoked: count });
});

// ---------------------------------------------------------------------------
// مخاطبین
// ---------------------------------------------------------------------------
api.get("/contacts", authed, (req, res) => {
  const me = (req as any).user as User;
  const contacts = listContacts(me.id).map((c) => ({
    id: c.id,
    name: c.name,
    alias: c.alias,
    phone: c.phone ? `***${c.phone.slice(-4)}` : null,
    phone_full: c.phone,
    tg_id: c.tg_id,
    contact_user_id: c.contact_user_id,
    user: c.contact_user_id ? publicUser(getUserById(c.contact_user_id) as User) : null,
    created_at: c.created_at,
  }));
  res.json({ ok: true, contacts });
});

api.post("/contacts", authed, (req, res) => {
  const me = (req as any).user as User;
  const { tg_id, username, phone, name, alias } = req.body ?? {};
  let contactUser: User | undefined;
  if (tg_id) {
    const tid = Number(tg_id);
    if (!Number.isInteger(tid)) return fail(res, 400, "bad_tg_id");
    contactUser = getUserByTgId(tid);
    if (!contactUser) return fail(res, 404, "not_found", "کاربری با این TG ID پیدا نشد.");
  } else if (username) {
    const uname = String(username).replace(/^@/, "").trim();
    const found = listUsers().find((u) => (u.username || "").toLowerCase() === uname.toLowerCase());
    if (!found) return fail(res, 404, "not_found", "یوزرنیم پیدا نشد.");
    contactUser = found;
  } else if (phone) {
    const nm = typeof name === "string" && name.trim() ? name.trim() : String(phone);
    const c = addContact(me.id, { phone: String(phone), name: nm, alias });
    return res.json({ ok: true, contact: c });
  } else {
    return fail(res, 400, "bad_input", "tg_id یا username یا phone لازم است.");
  }
  const c = addContact(me.id, {
    contactUserId: contactUser.id,
    name: typeof name === "string" && name.trim() ? name.trim() : contactUser.name,
    alias: alias ?? null,
    tgId: contactUser.tg_id,
  });
  res.json({ ok: true, contact: c, user: publicUser(contactUser) });
});

api.delete("/contacts/:id", authed, (req, res) => {
  const me = (req as any).user as User;
  const id = Number(req.params.id);
  if (!id) return fail(res, 400, "bad_id");
  const ok = deleteContact(me.id, id);
  if (!ok) return fail(res, 404, "not_found");
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// گروه‌ها و کانال‌ها
// ---------------------------------------------------------------------------
api.get("/groups", authed, (req, res) => {
  const me = (req as any).user as User;
  const groups = listGroupsForUser(me.id);
  res.json({ ok: true, groups });
});

api.post("/groups", authed, (req, res) => {
  const me = (req as any).user as User;
  const { name, type, memberIds, description } = req.body ?? {};
  if (!name || typeof name !== "string" || name.trim().length < 2)
    return fail(res, 400, "bad_name", "نام گروه باید حداقل ۲ حرف باشد.");
  const t = type === "channel" ? "channel" : "group";
  const members: number[] = Array.isArray(memberIds) ? memberIds.map(Number).filter((n) => Number.isInteger(n) && n > 0) : [];
  const g = createGroup(me.id, name, t as any, members, description || "");
  res.json({ ok: true, group: g });
});

api.get("/groups/:id", authed, (req, res) => {
  const me = (req as any).user as User;
  const gid = Number(req.params.id);
  const g = getGroupById(gid);
  if (!g) return fail(res, 404, "not_found");
  if (!isGroupMember(gid, me.id)) return fail(res, 403, "forbidden", "عضو گروه نیستی.");
  res.json({ ok: true, group: g, members: getGroupMembers(gid).map((m) => ({ user: publicUser(m.user), role: m.role })) });
});

api.put("/groups/:id", authed, (req, res) => {
  const me = (req as any).user as User;
  const gid = Number(req.params.id);
  const g = getGroupById(gid);
  if (!g) return fail(res, 404, "not_found");
  const members = getGroupMembers(gid);
  const myRole = members.find((m) => m.user.id === me.id)?.role;
  if (!myRole || !["owner", "admin"].includes(myRole)) return fail(res, 403, "forbidden", "فقط ادمین می‌تواند گروه را ویرایش کند.");
  const { name, description } = req.body ?? {};
  const updated = updateGroupInfo(gid, { name, description });
  res.json({ ok: true, group: updated });
});

api.post("/groups/:id/members", authed, (req, res) => {
  const me = (req as any).user as User;
  const gid = Number(req.params.id);
  const { userId, role } = req.body ?? {};
  const uid = Number(userId);
  if (!uid) return fail(res, 400, "bad_user");
  const g = getGroupById(gid);
  if (!g) return fail(res, 404, "not_found");
  if (!isGroupMember(gid, me.id)) return fail(res, 403, "forbidden");
  if (g.type === "channel") {
    const mems = getGroupMembers(gid);
    const myRole = mems.find((m) => m.user.id === me.id)?.role;
    if (!myRole || !["owner", "admin"].includes(myRole)) return fail(res, 403, "forbidden", "در کانال فقط ادمین می‌تواند عضو اضافه کند.");
  }
  const added = addGroupMember(gid, uid, role === "admin" ? "admin" : "member");
  if (!added) return fail(res, 400, "already_member", "قبلاً عضو بوده یا خطا.");
  res.json({ ok: true });
});

api.delete("/groups/:id/members/:uid", authed, (req, res) => {
  const me = (req as any).user as User;
  const gid = Number(req.params.id);
  const uid = Number(req.params.uid);
  if (!gid || !uid) return fail(res, 400, "bad_id");
  if (!isGroupMember(gid, me.id)) return fail(res, 403, "forbidden");
  if (uid !== me.id) {
    const mems = getGroupMembers(gid);
    const myRole = mems.find((m) => m.user.id === me.id)?.role;
    if (!myRole || !["owner", "admin"].includes(myRole)) return fail(res, 403, "forbidden");
  }
  const ok = removeGroupMember(gid, uid);
  if (!ok) return fail(res, 404, "not_found");
  res.json({ ok: true });
});

api.post("/groups/:id/invite", authed, (req, res) => {
  const me = (req as any).user as User;
  const gid = Number(req.params.id);
  const g = getGroupById(gid);
  if (!g) return fail(res, 404, "not_found");
  if (!isGroupMember(gid, me.id)) return fail(res, 403, "forbidden");
  const token = g.invite_token;
  const link = `https://t.me/${botUsername}?start=invite_${token}`;
  res.json({ ok: true, token, link });
});

api.post("/groups/join/:token", authed, (req, res) => {
  const me = (req as any).user as User;
  const token = String(req.params.token);
  const g = getGroupByInvite(token);
  if (!g) return fail(res, 404, "not_found", "لینک دعوت نامعتبر است.");
  if (isGroupMember(g.id, me.id)) return res.json({ ok: true, group: g, already: true });
  addGroupMember(g.id, me.id);
  res.json({ ok: true, group: g });
});

api.get("/groups/:id/messages", authed, (req, res) => {
  const me = (req as any).user as User;
  const gid = Number(req.params.id);
  if (!isGroupMember(gid, me.id)) return fail(res, 403, "forbidden");
  const msgs = getGroupHistory(gid, 200);
  res.json({ ok: true, messages: msgs });
});

// ---------------------------------------------------------------------------
// پیام‌ها (شخصی + گروهی ابری) + فایل
// ---------------------------------------------------------------------------
api.post("/messages", authed, (req, res) => {
  const me = (req as any).user as User;
  const to = Number(req.body?.to);
  const groupId = req.body?.group ? Number(req.body.group) : null;
  const text = typeof req.body?.text === "string" ? req.body.text.trim().slice(0, 4096) : "";
  const file = req.body?.file as { url: string; name: string; size: number; mime: string; type: string } | null;
  const replyTo = req.body?.reply_to ? Number(req.body.reply_to) : null;

  if (!text && !file) return fail(res, 400, "bad_input", "متن یا فایل خالی است.");

  try {
    if (groupId) {
      if (!isGroupMember(groupId, me.id)) return fail(res, 403, "forbidden", "عضو گروه نیستی.");
      const g = getGroupById(groupId);
      if (g?.type === "channel") {
        const members = getGroupMembers(groupId);
        const myRole = members.find((m) => m.user.id === me.id)?.role;
        if (!myRole || !["owner", "admin"].includes(myRole)) return fail(res, 403, "forbidden", "فقط ادمین کانال می‌تواند پیام بفرستد.");
      }
      const row = insertGroupMessage(me.id, groupId, text, file as any, replyTo);
      const event = {
        t: "msg",
        id: row.id,
        from: me.id,
        group: groupId,
        text: row.text,
        ts: row.ts,
        msg_type: row.msg_type,
        file_url: row.file_url,
        file_name: row.file_name,
        file_size: row.file_size,
        mime: row.mime,
        reply_to: row.reply_to,
      };
      broadcastGroup(groupId, event);
      return res.json({ ok: true, message: row, event });
    } else {
      if (!to) return fail(res, 400, "bad_input", "مقصد نامشخص است.");
      const peer = getUserById(to);
      if (!peer) return fail(res, 404, "no_peer", "کاربر پیدا نشد.");
      const row = insertMessage(me.id, peer.id, text, null, file as any, replyTo);
      if (peer.id === me.id) {
        const { markRead } = require("./db");
        markRead(me.id, me.id);
      }
      const event = {
        t: "msg",
        id: row.id,
        from: me.id,
        to: peer.id,
        text: row.text,
        ts: row.ts,
        read: peer.id === me.id,
        msg_type: row.msg_type,
        file_url: row.file_url,
        file_name: row.file_name,
        file_size: row.file_size,
        mime: row.mime,
        reply_to: row.reply_to,
      };
      if (peer.id !== me.id) notifyUser(peer.id, event);
      return res.json({ ok: true, message: row, event });
    }
  } catch (e) {
    console.error("[api] post /messages", e);
    return fail(res, 500, "internal");
  }
});

api.get("/conversations", authed, (req, res) => {
  const me = (req as any).user as User;
  const last = getLastMessages(me.id);
  const unread = {
    ...(require("./db").unreadCounts(me.id) as any),
    groups: unreadGroupCounts(me.id),
  };
  res.json({ ok: true, last, unread });
});

api.get("/export", authed, (req, res) => {
  const me = (req as any).user as User;
  const messages = getAllMessagesForUser(me.id, 5000);
  const groups = listGroupsForUser(me.id);
  const contacts = listContacts(me.id);
  res.json({ ok: true, me: publicUser(me), messages, groups, contacts, exported_at: Date.now() });
});

api.get("/messages", authed, (req, res) => {
  const me = (req as any).user as User;
  const peerId = Number(req.query.with);
  const groupId = req.query.group ? Number(req.query.group) : null;

  if (groupId) {
    if (!isGroupMember(groupId, me.id)) return fail(res, 403, "forbidden");
    const messages = getGroupHistory(groupId, 200);
    return res.json({ ok: true, messages });
  }

  const peer = peerId ? getUserById(peerId) : undefined;
  if (!peer) return fail(res, 404, "no_peer", "چنین کاربری وجود ندارد.");

  const messages = getHistory(me.id, peer.id, 200);
  const changed = markRead(me.id, peer.id);
  if (changed > 0) notifyUser(peer.id, { t: "read", by: me.id });
  res.json({ ok: true, messages });
});

api.get("/health", (_req, res) => {
  res.json({ ok: true, bot: botReady() ? "ready" : "connecting", uptime: process.uptime(), proto: "tcp+ws (deflate) + http-upload" });
});

export { handleDeepLink };
