import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { config } from "./config";

fs.mkdirSync(config.dataDir, { recursive: true });

export const db = new Database(path.join(config.dataDir, "payam.db"));
db.pragma("journal_mode = WAL");

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
CREATE INDEX IF NOT EXISTS idx_msg_sender    ON messages(sender, recipient, ts);
CREATE INDEX IF NOT EXISTS idx_msg_recipient ON messages(recipient, sender, read_at);
`);

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

export const now = (): number => Date.now();

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
  // کدهای قبلیِ همین آی‌دی باطل شوند
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
// پیام‌ها
// ---------------------------------------------------------------------------

export function insertMessage(
  sender: number,
  recipient: number,
  text: string
): MessageRow {
  const ts = now();
  const info = db
    .prepare(
      "INSERT INTO messages (sender, recipient, text, ts) VALUES (?, ?, ?, ?)"
    )
    .run(sender, recipient, text, ts);
  return {
    id: Number(info.lastInsertRowid),
    sender,
    recipient,
    text,
    ts,
    read_at: null,
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
       WHERE (sender = ? AND recipient = ?) OR (sender = ? AND recipient = ?)
       ORDER BY ts DESC LIMIT ?`
    )
    .all(a, b, b, a, limit)
    .reverse() as MessageRow[];
}

/** پیام‌های خوانده‌نشده‌ی از طرف peer به من را خوانده‌شده کن؛ تعدادشان را برگردان */
export function markRead(me: number, peer: number): number {
  const info = db
    .prepare(
      `UPDATE messages SET read_at = ?
       WHERE recipient = ? AND sender = ? AND read_at IS NULL`
    )
    .run(now(), me, peer);
  return info.changes;
}

export function unreadCounts(me: number): Record<number, number> {
  const rows = db
    .prepare<[number]>(
      `SELECT sender, COUNT(*) AS c FROM messages
       WHERE recipient = ? AND read_at IS NULL GROUP BY sender`
    )
    .all(me) as Array<{ sender: number; c: number }>;
  const out: Record<number, number> = {};
  for (const r of rows) out[r.sender] = r.c;
  return out;
}
