import crypto from "crypto";
import {
  createAuthCode,
  getAuthCode,
  markAuthCodeUsed,
  cleanupAuthCodes,
  createSession,
  getUserByTokenHash,
  deleteSession,
  upsertUserByTgId,
  getUserByTgId,
  now,
  User,
} from "./db";

export const CODE_TTL_MS = 5 * 60 * 1000; // ۵ دقیقه

export const sha256 = (s: string): string =>
  crypto.createHash("sha256").update(s).digest("hex");

export function newSessionToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function newLoginToken(): string {
  return crypto.randomBytes(24).toString("base64url");
}

export function newCode(): string {
  return String(crypto.randomInt(10000, 100000));
}

export function userByToken(token: string | undefined | null): User | undefined {
  if (!token) return undefined;
  return getUserByTokenHash(sha256(token));
}

export function registerSession(token: string, userId: number): void {
  createSession(sha256(token), userId);
}

export function revokeSession(token: string): void {
  deleteSession(sha256(token));
}

// ---------------------------------------------------------------------------
// ریت‌لیمیت ساده درون‌حافظه‌ای
// ---------------------------------------------------------------------------

const buckets = new Map<string, number[]>();

function rateLimit(key: string, max: number, windowMs: number): boolean {
  const t = now();
  const arr = (buckets.get(key) ?? []).filter((x) => t - x < windowMs);
  if (arr.length >= max) {
    buckets.set(key, arr);
    return false;
  }
  arr.push(t);
  buckets.set(key, arr);
  return true;
}

export function rateLimitOk(kind: "tg" | "ip", id: string): boolean {
  return kind === "tg"
    ? rateLimit(`tg:${id}`, 3, 10 * 60 * 1000) // هر آی‌دی: ۳ بار در ۱۰ دقیقه
    : rateLimit(`ip:${id}`, 15, 30 * 60 * 1000); // هر آی‌پی: ۱۵ بار در ۳۰ دقیقه
}

// هر دقیقه کدهای منقضی پاک شوند
setInterval(cleanupAuthCodes, 60 * 1000).unref();

// ---------------------------------------------------------------------------
// فلو احراز هویت
// ---------------------------------------------------------------------------

export interface LoginRequestResult {
  loginToken: string;
  code: string;
}

/** ساخت کد ورود برای یک آی‌دی تلگرام */
export function createLoginRequest(tgId: number): LoginRequestResult {
  const loginToken = newLoginToken();
  const code = newCode();
  createAuthCode(loginToken, tgId, code, CODE_TTL_MS);
  return { loginToken, code };
}

export interface CompletedLogin {
  sessionToken: string;
  user: User;
}

/**
 * کامل‌کردن ورود: چه با کد دستی و چه با دیپ‌لینک بات.
 * fetchProfile باید نام/یوزرنیم را از تلگرام بگیرد.
 */
export async function completeLogin(
  loginToken: string,
  opts: { expectedTgId?: number; providedCode?: string },
  fetchProfile: (tgId: number) => Promise<{ name: string; username: string | null }>
): Promise<CompletedLogin | { error: string }> {
  const row = getAuthCode(loginToken);
  if (!row) return { error: "not_found" };
  if (row.used && row.session_token) {
    // قبلاً کامل شده — توکن قبلی را برگردان (پاسخ به poll کلاینت)
    const user = getUserByTgId(row.tg_id);
    if (user) return { sessionToken: row.session_token, user };
    return { error: "not_found" };
  }
  if (row.used) return { error: "used" };
  if (now() > row.expires_at) return { error: "expired" };
  if (opts.expectedTgId !== undefined && row.tg_id !== opts.expectedTgId)
    return { error: "mismatch" };
  if (opts.providedCode !== undefined && opts.providedCode !== row.code)
    return { error: "wrong_code" };

  let profile = { name: "", username: null as string | null };
  try {
    profile = await fetchProfile(row.tg_id);
  } catch {
    /* آفلاین بودن تلگرام نباید مانع ورود شود */
  }

  const user = upsertUserByTgId(
    row.tg_id,
    profile.name || `کاربر ${row.tg_id}`,
    profile.username
  );
  const sessionToken = newSessionToken();
  registerSession(sessionToken, user.id);
  markAuthCodeUsed(loginToken, sessionToken);
  return { sessionToken, user };
}
