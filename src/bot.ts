import { Bot, GrammyError } from "grammy";
import { config } from "./config";
import { completeLogin } from "./auth";
import { getUserByTgId } from "./db";

export let bot: Bot | null = null;
export let botUsername: string | null = null;

type DeepLinkHandler = (loginToken: string, tgId: number) => Promise<string | null>;

let deepLinkHandler: DeepLinkHandler | null = null;

/** آیا بات آماده است؟ */
export function botReady(): boolean {
  return bot !== null && botUsername !== null;
}

async function fetchProfile(tgId: number): Promise<{ name: string; username: string | null }> {
  if (!bot) return { name: "", username: null };
  const chat = await bot.api.getChat(tgId);
  if (chat.type === "private") {
    const name = [chat.first_name, chat.last_name].filter(Boolean).join(" ");
    return { name, username: chat.username ?? null };
  }
  return { name: "", username: null };
}

/** ارسال کد ورود به کاربر تلگرام؛ اگر بات را استارت نکرده باشد false */
export async function sendLoginCode(tgId: number, code: string): Promise<boolean> {
  if (!bot) return false;
  try {
    await bot.api.sendMessage(
      tgId,
      `🔑 کد ورود شما به پیام‌رسان «پیام»:\n\n` +
        `<b>${code}</b>\n\n` +
        `⏱ این کد ۵ دقیقه اعتبار دارد و فقط یک‌بار مصرف می‌شود.\n` +
        `⚠️ اگر شما درخواست ورود ندادید، این پیام را نادیده بگیرید.`,
      { parse_mode: "HTML" }
    );
    return true;
  } catch (e) {
    if (e instanceof GrammyError) return false; // مثلاً 403: کاربر بات را استارت نکرده
    throw e;
  }
}

export function initBot(onDeepLink: DeepLinkHandler): Promise<void> {
  deepLinkHandler = onDeepLink;
  return connectWithRetry();
}

async function connectWithRetry(attempt = 1): Promise<void> {
  if (!config.botToken) {
    console.warn("[bot] توکن بات تنظیم نشده — حالت بدون تلگرام (فقط برای توسعه).");
    return;
  }
  try {
    await connect();
  } catch (e) {
    const wait = Math.min(30, attempt * 5);
    console.error(`[bot] اتصال به تلگرام ناموفق بود (${attempt}). تلاش بعدی ${wait} ثانیه دیگر...`);
    setTimeout(() => connectWithRetry(attempt + 1).catch(() => {}), wait * 1000);
  }
}

async function connect(): Promise<void> {
  const b = new Bot(config.botToken);
  const me = await b.api.getMe();
  botUsername = me.username ?? null;
  bot = b;
  console.log(`[bot] متصل شدم: @${botUsername}`);

  b.command("id", async (ctx) => {
    if (!ctx.from) return;
    await ctx.reply(`🆔 آی‌دی عددی شما:\n${ctx.from.id}\n\nاین عدد را در صفحه‌ی ورود پیام‌رسان وارد کنید.`);
  });

  b.command("start", async (ctx) => {
    if (!ctx.from) return;
    const payload = typeof ctx.match === "string" ? ctx.match.trim() : "";
    if (payload.length >= 20 && deepLinkHandler) {
      const result = await deepLinkHandler(payload, ctx.from.id);
      await ctx.reply(result ?? "❌ لینک ورود نامعتبر یا منقضی است. دوباره از پیام‌رسان امتحان کنید.");
      return;
    }
    const name = ctx.from.first_name ?? "";
    await ctx.reply(
      `سلام ${name}! 👋\n` +
        `این باتِ احراز هویت پیام‌رسان «پیام» است.\n\n` +
        `📝 برای ساخت اکانت:\n` +
        `۱. دستور /id را بفرست تا آی‌دی عددی‌ات را ببینی\n` +
        `۲. آن را در صفحه‌ی ورود پیام‌رسان وارد کن\n` +
        `۳. کدی که همین‌جا برایت می‌فرستم را در پیام‌رسان وارد کن`
    );
  });

  b.on("message", async (ctx) => {
    await ctx.reply("🤖 فقط دستورهای /start و /id پشتیبانی می‌شوند.");
  });

  b.catch((err) => {
    console.error("[bot] خطا:", err.error);
  });

  // لانگ‌پولینگ در پس‌زمینه
  b.start({
    onStart: () => console.log("[bot] دریافت آپدیت‌ها شروع شد (long polling)"),
  }).catch((e) => console.error("[bot] خطای long polling:", e));
}

/** کامل‌کردن ورود از طریق دیپ‌لینک /start */
export async function handleDeepLink(loginToken: string, tgId: number): Promise<string | null> {
  const res = await completeLogin(loginToken, { expectedTgId: tgId }, fetchProfile);
  if ("error" in res) return null;
  return (
    `✅ ورود موفق!\nحالا به پیام‌رسان «پیام» برگرد؛ خودکار وارد می‌شوی.\n\n` +
    `👤 نام: ${res.user.name || "—"}`
  );
}

export { fetchProfile };
