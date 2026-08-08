import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { config } from "./config";

fs.mkdirSync(config.dataDir, { recursive: true });

export const db = new Database(path.join(config.dataDir, "payam.db"));
db.pragma("journal_mode = WAL");

// مرحله ۱: جداول پایه (بدون ایندکس‌هایی که به ستون جدید وابستند — برای سازگاری با دیتابیس قدیمی)
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  tg_id      INTEGER UNIQUE NOT NULL,
  name       TEXT NOT NULL DEFAULT '',
  username   TEXT,
  created_at INTEGER NOT NULL,
  last_seen  INTEGER
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_codes (
  login_token   TEXT PRIMARY KEY,
  tg_id         INTEGER NOT NULL,
  code          TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  expires_at    INTEGER NOT NULL,
  used          INTEGER NOT NULL DEFAULT 0,
  session_token TEXT
);

CREATE TABLE IF NOT EXISTS messages (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  sender    INTEGER NOT NULL REFERENCES users(id),
  recipient INTEGER NOT NULL REFERENCES users(id),
  text      TEXT NOT NULL,
  ts        INTEGER NOT NULL,
  read_at   INTEGER
);

CREATE TABLE IF NOT EXISTS contacts (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  contact_user_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  phone            TEXT,
  name             TEXT NOT NULL,
  alias            TEXT,
  tg_id            INTEGER,
  created_at       INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS groups (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL,
  description  TEXT DEFAULT '',
  creator_id   INTEGER NOT NULL REFERENCES users(id),
  type         TEXT NOT NULL DEFAULT 'group',
  invite_token TEXT UNIQUE,
  avatar       TEXT,
  created_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS group_members (
  group_id  INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role      TEXT NOT NULL DEFAULT 'member',
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (group_id, user_id)
);
`);

// مایگریشن‌های سبک برای دیتابیس‌های قدیمی — اضافه کردن ستون‌ها اگر نیستند
try { db.prepare("ALTER TABLE messages ADD COLUMN group_id INTEGER").run(); } catch {}
try { db.prepare("ALTER TABLE messages ADD COLUMN reply_to INTEGER").run(); } catch {}
try { db.prepare("ALTER TABLE groups ADD COLUMN type TEXT NOT NULL DEFAULT 'group'").run(); } catch {}
try { db.prepare("ALTER TABLE groups ADD COLUMN invite_token TEXT").run(); } catch {}
try { db.prepare("ALTER TABLE groups ADD COLUMN description TEXT DEFAULT ''").run(); } catch {}
try { db.prepare("ALTER TABLE groups ADD COLUMN avatar TEXT").run(); } catch {}
try { db.prepare("ALTER TABLE contacts ADD COLUMN alias TEXT").run(); } catch {}
try { db.prepare("ALTER TABLE contacts ADD COLUMN tg_id INTEGER").run(); } catch {}

// ایندکس‌ها — بعد از مایگریشن تا اگر ستون نبود کرش نکنه
try { db.exec("CREATE INDEX IF NOT EXISTS idx_msg_sender ON messages(sender, recipient, ts)"); } catch {}
try { db.exec("CREATE INDEX IF NOT EXISTS idx_msg_recipient ON messages(recipient, sender, read_at)"); } catch {}
try { db.exec("CREATE INDEX IF NOT EXISTS idx_msg_group ON messages(group_id, ts)"); } catch {}
try { db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_groups_invite ON groups(invite_token)"); } catch {}
try { db.exec("CREATE INDEX IF NOT EXISTS idx_contacts_owner ON contacts(owner_id)"); } catch {}
try { db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_unique_user ON contacts(owner_id, contact_user_id)"); } catch {}
try { db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_unique_phone ON contacts(owner_id, phone)"); } catch {}

// ---------------------------------------------------------------------------
// تایپ‌ها
// ---------------------------------------------------------------------------

export interface User {
  id: number;
  tg_id: number;
  name: string;
  username: string | null;
  created_at: number;
  last_seen: number | null;
}

export interface MessageRow {
  id: number;
  sender: number;
  recipient: number;
  text: string;
  ts: number;
  read_at: number | null;
  group_id: number | null;
  reply_to: number | null;
}

export interface AuthCodeRow {
  login_token: string;
  tg_id: number;
  code: string;
  created_at: number;
  expires_at: number;
  used: number;
  session_token: string | null;
}

export interface ContactRow {
  id: number;
  owner_id: number;
  contact_user_id: number | null;
  phone: string | null;
  name: string;
  alias: string | null;
  tg_id: number | null;
  created_at: number;
  // joined from users
  user_name?: string;
  user_username?: string | null;
  user_online?: boolean;
}

export interface GroupRow {
  id: number;
  name: string;
  description: string;
  creator_id: number;
  type: string;
  invite_token: string | null;
  avatar: string | null;
  created_at: number;
  member_count?: number;
  role?: string;
}

export const now = (): number => Date.now();

function genInvite(): string {
  return Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);
}

// ---------------------------------------------------------------------------
// کاربران
// ---------------------------------------------------------------------------

export function upsertUserByTgId(
  tgId: number,
  name: string,
  username: string | null
): User {
  const existing = db
    .prepare<[number]>("SELECT * FROM users WHERE tg_id = ?")
    .get(tgId);
  if (existing) {
    db.prepare(
      "UPDATE users SET name = ?, username = ? WHERE tg_id = ?"
    ).run(name, username, tgId);
  } else {
    db.prepare(
      "INSERT INTO users (tg_id, name, username, created_at) VALUES (?, ?, ?, ?)"
    ).run(tgId, name, username, now());
  }
  return db.prepare<[number]>("SELECT * FROM users WHERE tg_id = ?").get(tgId) as User;
}

export function getUserById(id: number): User | undefined {
  return db.prepare<[number]>("SELECT * FROM users WHERE id = ?").get(id) as
    | User
    | undefined;
}

export function getUserByTgId(tgId: number): User | undefined {
  return db.prepare<[number]>("SELECT * FROM users WHERE tg_id = ?").get(tgId) as
    | User
    | undefined;
}

export function listUsers(): User[] {
  return db.prepare("SELECT * FROM users ORDER BY name COLLATE NOCASE").all() as User[];
}

export function touchLastSeen(userId: number): void {
  db.prepare("UPDATE users SET last_seen = ? WHERE id = ?").run(now(), userId);
}

// ---------------------------------------------------------------------------
// سشن‌ها
// ---------------------------------------------------------------------------

export function createSession(tokenHash: string, userId: number): void {
  db.prepare(
    "INSERT INTO sessions (token_hash, user_id, created_at) VALUES (?, ?, ?)"
  ).run(tokenHash, userId, now());
}

export function getUserByTokenHash(tokenHash: string): User | undefined {
  return db
    .prepare<[string]>(
      `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ?`
    )
    .get(tokenHash) as User | undefined;
}

export function deleteSession(tokenHash: string): void {
  db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
}

// ---------------------------------------------------------------------------
// کدهای احراز هویت
// ---------------------------------------------------------------------------

export function createAuthCode(
  loginToken: string,
  tgId: number,
  code: string,
  ttlMs: number
): void {
  db.prepare("DELETE FROM auth_codes WHERE tg_id = ? AND used = 0").run(tgId);
  const t = now();
  db.prepare(
    `INSERT INTO auth_codes (login_token, tg_id, code, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(loginToken, tgId, code, t, t + ttlMs);
}

export function getAuthCode(loginToken: string): AuthCodeRow | undefined {
  return db
    .prepare<[string]>("SELECT * FROM auth_codes WHERE login_token = ?")
    .get(loginToken) as AuthCodeRow | undefined;
}

export function markAuthCodeUsed(loginToken: string, sessionToken: string): void {
  db.prepare(
    "UPDATE auth_codes SET used = 1, session_token = ? WHERE login_token = ?"
  ).run(sessionToken, loginToken);
}

export function cleanupAuthCodes(): void {
  db.prepare("DELETE FROM auth_codes WHERE expires_at < ? AND used = 0").run(now());
}

// ---------------------------------------------------------------------------
// پیام‌ها (شخصی + گروهی)
// ---------------------------------------------------------------------------

export function insertMessage(
  sender: number,
  recipient: number,
  text: string,
  groupId: number | null = null
): MessageRow {
  const ts = now();
  const info = db
    .prepare(
      "INSERT INTO messages (sender, recipient, text, ts, group_id) VALUES (?, ?, ?, ?, ?)"
    )
    .run(sender, recipient, text, ts, groupId);
  return {
    id: Number(info.lastInsertRowid),
    sender,
    recipient,
    text,
    ts,
    read_at: null,
    group_id: groupId,
    reply_to: null,
  };
}

export function insertGroupMessage(
  sender: number,
  groupId: number,
  text: string
): MessageRow {
  const ts = now();
  // برای گروه، recipient را برابر sender می‌گذاریم تا FK رد نشود ولی group_id اصلی است
  const info = db
    .prepare(
      "INSERT INTO messages (sender, recipient, text, ts, group_id) VALUES (?, ?, ?, ?, ?)"
    )
    .run(sender, sender, text, ts, groupId);
  return {
    id: Number(info.lastInsertRowid),
    sender,
    recipient: sender,
    text,
    ts,
    read_at: null,
    group_id: groupId,
    reply_to: null,
  };
}

export function getHistory(
  a: number,
  b: number,
  limit = 200
): MessageRow[] {
  return db
    .prepare<[number, number, number, number, number]>(
      `SELECT * FROM messages
       WHERE group_id IS NULL AND ((sender = ? AND recipient = ?) OR (sender = ? AND recipient = ?))
       ORDER BY ts DESC LIMIT ?`
    )
    .all(a, b, b, a, limit)
    .reverse() as MessageRow[];
}

export function getGroupHistory(groupId: number, limit = 200): MessageRow[] {
  return db
    .prepare<[number, number]>(
      `SELECT * FROM messages WHERE group_id = ? ORDER BY ts DESC LIMIT ?`
    )
    .all(groupId, limit)
    .reverse() as MessageRow[];
}

export function markRead(me: number, peer: number): number {
  const info = db
    .prepare(
      `UPDATE messages SET read_at = ?
       WHERE group_id IS NULL AND recipient = ? AND sender = ? AND read_at IS NULL`
    )
    .run(now(), me, peer);
  return info.changes;
}

export function getLastMessages(me: number): Record<number, MessageRow> {
  const rows = db
    .prepare<[number, number, number]>(
      `SELECT * FROM messages
       WHERE (sender = ? OR recipient = ? OR group_id IN (SELECT group_id FROM group_members WHERE user_id = ?))
       ORDER BY ts DESC`
    )
    .all(me, me, me) as MessageRow[];
  const out: Record<number, MessageRow> = {};
  const seenGroups = new Set<number>();
  for (const m of rows) {
    if (m.group_id) {
      if (seenGroups.has(m.group_id)) continue;
      seenGroups.add(m.group_id);
      out[-m.group_id] = m; // کلید منفی برای گروه تا با کاربر قاطی نشه
      continue;
    }
    const peer = m.sender === me ? m.recipient : m.sender;
    if (out[peer]) continue;
    out[peer] = m;
  }
  return out;
}

export function getAllMessagesForUser(me: number, limit = 1000): MessageRow[] {
  return db
    .prepare<[number, number, number, number]>(
      `SELECT * FROM messages
       WHERE sender = ? OR recipient = ? OR group_id IN (SELECT group_id FROM group_members WHERE user_id = ?)
       ORDER BY ts ASC LIMIT ?`
    )
    .all(me, me, me, limit) as MessageRow[];
}

// ---------------------------------------------------------------------------
// مخاطبین
// ---------------------------------------------------------------------------

export function addContact(
  ownerId: number,
  opts: { contactUserId?: number; phone?: string; name: string; alias?: string; tgId?: number }
): ContactRow {
  const existing = opts.contactUserId
    ? db.prepare<[number, number]>("SELECT * FROM contacts WHERE owner_id = ? AND contact_user_id = ?").get(ownerId, opts.contactUserId)
    : opts.phone
      ? db.prepare<[number, string]>("SELECT * FROM contacts WHERE owner_id = ? AND phone = ?").get(ownerId, opts.phone)
      : undefined;

  if (existing) return existing as ContactRow;

  const info = db
    .prepare(
      `INSERT INTO contacts (owner_id, contact_user_id, phone, name, alias, tg_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      ownerId,
      opts.contactUserId ?? null,
      opts.phone ?? null,
      opts.name,
      opts.alias ?? null,
      opts.tgId ?? null,
      now()
    );
  return db.prepare<[number]>("SELECT * FROM contacts WHERE id = ?").get(Number(info.lastInsertRowid)) as ContactRow;
}

export function listContacts(ownerId: number): ContactRow[] {
  return db
    .prepare<[number]>(
      `SELECT c.*, u.name as user_name, u.username as user_username
       FROM contacts c LEFT JOIN users u ON u.id = c.contact_user_id
       WHERE c.owner_id = ? ORDER BY c.name COLLATE NOCASE`
    )
    .all(ownerId) as ContactRow[];
}

export function deleteContact(ownerId: number, contactId: number): boolean {
  const info = db.prepare<[number, number]>("DELETE FROM contacts WHERE id = ? AND owner_id = ?").run(contactId, ownerId);
  return info.changes > 0;
}

export function getContactByPhone(ownerId: number, phone: string): ContactRow | undefined {
  return db
    .prepare<[number, string]>("SELECT * FROM contacts WHERE owner_id = ? AND phone = ?")
    .get(ownerId, phone) as ContactRow | undefined;
}

// هندلر بات: وقتی کاربر تلگرام مخاطب شیر می‌کند
export function handleTelegramContactShare(
  ownerTgId: number,
  contact: { phone_number: string; first_name: string; last_name?: string; user_id?: number }
): { contact: ContactRow; linkedUser?: User } {
  const owner = getUserByTgId(ownerTgId);
  if (!owner) throw new Error("owner not found");

  let linkedUser: User | undefined;
  if (contact.user_id) {
    linkedUser = getUserByTgId(contact.user_id);
  }

  const name = [contact.first_name, contact.last_name].filter(Boolean).join(" ") || contact.phone_number;

  const row = addContact(owner.id, {
    contactUserId: linkedUser?.id,
    phone: contact.phone_number,
    name,
    tgId: contact.user_id,
  });

  return { contact: row, linkedUser };
}

// ---------------------------------------------------------------------------
// گروه‌ها و کانال‌ها
// ---------------------------------------------------------------------------

export function createGroup(
  creatorId: number,
  name: string,
  type: "group" | "channel" = "group",
  memberIds: number[] = [],
  description = ""
): GroupRow {
  const token = genInvite();
  const info = db
    .prepare(
      `INSERT INTO groups (name, description, creator_id, type, invite_token, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(name.trim().slice(0, 80) || "گروه بدون نام", description.slice(0, 500), creatorId, type, token, now());
  const groupId = Number(info.lastInsertRowid);

  db.prepare(
    `INSERT INTO group_members (group_id, user_id, role, joined_at) VALUES (?, ?, 'owner', ?)`
  ).run(groupId, creatorId, now());

  const unique = [...new Set(memberIds)].filter((id) => id !== creatorId);
  for (const uid of unique) {
    try {
      db.prepare(
        `INSERT INTO group_members (group_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?)`
      ).run(groupId, uid, now());
    } catch {}
  }

  return getGroupById(groupId)!;
}

export function getGroupById(id: number): GroupRow | undefined {
  const row = db.prepare<[number]>("SELECT * FROM groups WHERE id = ?").get(id) as GroupRow | undefined;
  if (!row) return undefined;
  const cnt = db.prepare<[number]>("SELECT COUNT(*) as c FROM group_members WHERE group_id = ?").get(id) as { c: number };
  row.member_count = cnt.c;
  return row;
}

export function listGroupsForUser(userId: number): GroupRow[] {
  return db
    .prepare<[number]>(
      `SELECT g.*, gm.role, (SELECT COUNT(*) FROM group_members WHERE group_id = g.id) as member_count
       FROM groups g JOIN group_members gm ON gm.group_id = g.id
       WHERE gm.user_id = ? ORDER BY g.created_at DESC`
    )
    .all(userId) as GroupRow[];
}

export function isGroupMember(groupId: number, userId: number): boolean {
  const row = db
    .prepare<[number, number]>("SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?")
    .get(groupId, userId);
  return !!row;
}

export function getGroupMembers(groupId: number): Array<{ user: User; role: string; joined_at: number }> {
  const rows = db
    .prepare<[number]>(
      `SELECT u.*, gm.role, gm.joined_at
       FROM group_members gm JOIN users u ON u.id = gm.user_id
       WHERE gm.group_id = ? ORDER BY gm.joined_at ASC`
    )
    .all(groupId) as Array<User & { role: string; joined_at: number }>;
  return rows.map((r) => ({
    user: { id: r.id, tg_id: r.tg_id, name: r.name, username: r.username, created_at: r.created_at, last_seen: r.last_seen } as User,
    role: r.role,
    joined_at: r.joined_at,
  }));
}

export function addGroupMember(groupId: number, userId: number, role = "member"): boolean {
  try {
    db.prepare(
      `INSERT INTO group_members (group_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)`
    ).run(groupId, userId, role, now());
    return true;
  } catch {
    return false;
  }
}

export function removeGroupMember(groupId: number, userId: number): boolean {
  const info = db.prepare<[number, number]>("DELETE FROM group_members WHERE group_id = ? AND user_id = ?").run(groupId, userId);
  return info.changes > 0;
}

export function setGroupMemberRole(groupId: number, userId: number, role: string): boolean {
  const info = db.prepare<[string, number, number]>("UPDATE group_members SET role = ? WHERE group_id = ? AND user_id = ?").run(role, groupId, userId);
  return info.changes > 0;
}

export function getGroupByInvite(token: string): GroupRow | undefined {
  return db.prepare<[string]>("SELECT * FROM groups WHERE invite_token = ?").get(token) as GroupRow | undefined;
}

export function updateGroupInfo(groupId: number, fields: { name?: string; description?: string }): GroupRow | undefined {
  if (fields.name) {
    db.prepare("UPDATE groups SET name = ? WHERE id = ?").run(fields.name.slice(0, 80), groupId);
  }
  if (fields.description !== undefined) {
    db.prepare("UPDATE groups SET description = ? WHERE id = ?").run(fields.description.slice(0, 500), groupId);
  }
  return getGroupById(groupId);
}

// ---------------------------------------------------------------------------
// دیگر توابع
// ---------------------------------------------------------------------------

export function updateUserName(id: number, name: string): User | undefined {
  const trimmed = name.trim().replace(/\s+/g, " ").slice(0, 64);
  if (trimmed.length < 1) return undefined;
  db.prepare("UPDATE users SET name = ? WHERE id = ?").run(trimmed, id);
  return getUserById(id);
}

export function listSessionsByUser(userId: number): Array<{ token_hash: string; created_at: number }> {
  return db
    .prepare<[number]>("SELECT token_hash, created_at FROM sessions WHERE user_id = ? ORDER BY created_at DESC")
    .all(userId) as Array<{ token_hash: string; created_at: number }>;
}

export function deleteSessionsExcept(userId: number, keepHash: string): number {
  const info = db
    .prepare<[number, string]>("DELETE FROM sessions WHERE user_id = ? AND token_hash != ?")
    .run(userId, keepHash);
  return info.changes;
}

export function unreadCounts(me: number): Record<number, number> {
  const rows = db
    .prepare<[number]>(
      `SELECT sender, COUNT(*) AS c FROM messages
       WHERE group_id IS NULL AND recipient = ? AND read_at IS NULL AND sender != recipient
       GROUP BY sender`
    )
    .all(me) as Array<{ sender: number; c: number }>;
  const out: Record<number, number> = {};
  for (const r of rows) out[r.sender] = r.c;
  return out;
}

export function unreadGroupCounts(me: number): Record<number, number> {
  const rows = db
    .prepare<[number, number]>(
      `SELECT group_id as gid, COUNT(*) as c FROM messages
       WHERE group_id IN (SELECT group_id FROM group_members WHERE user_id = ?)
         AND sender != ?
       GROUP BY group_id`
    )
    .all(me, me) as Array<{ gid: number; c: number }>;
  const out: Record<number, number> = {};
  for (const r of rows) out[r.gid] = r.c;
  return out;
}
