import { Bot, GrammyError } from "grammy";
import { config } from "./config";
import { completeLogin } from "./auth";
import {
  getUserByTgId,
  upsertUserByTgId,
  handleTelegramContactShare,
  listContacts,
  addContact,
  getGroupByInvite,
  addGroupMember,
  isGroupMember,
} from "./db";

export let bot: Bot | null = null;
export let botUsername: string | null = null;

type DeepLinkHandler = (loginToken: string, tgId: number) => Promise<string | null>;

let deepLinkHandler: DeepLinkHandler | null = null;

export function botReady(): boolean {
  return bot !== null && botUsername !== null;
}

async function fetchProfile(tgId: number): Promise<{ name: string; username: string | null }> {
  if (!bot) return { name: "", username: null };
  try {
    const chat = await bot.api.getChat(tgId);
    if (chat.type === "private") {
      const name = [chat.first_name, chat.last_name].filter(Boolean).join(" ");
      return { name, username: chat.username ?? null };
    }
  } catch {}
  return { name: "", username: null };
}

export async function sendLoginCode(tgId: number, code: string): Promise<boolean> {
  if (!bot) return false;
  try {
    await bot.api.sendMessage(
      tgId,
      `🔑 کد ورود شما به پیام‌رسان <b>Furina mind</b>:\n\n<code>${code}</code>\n\n⏱ این کد ۵ دقیقه اعتبار دارد و فقط یک‌بار مصرف می‌شود.\n⚠️ اگر شما درخواست ورود ندادید، این پیام را نادیده بگیرید.`,
      {
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [[{ text: "📋 کپی کد", copy_text: { text: code } }]],
        },
      }
    );
    return true;
  } catch (e) {
    if (e instanceof GrammyError) return false;
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

  // /id — آی‌دی عددی
  b.command("id", async (ctx) => {
    if (!ctx.from) return;
    const id = String(ctx.from.id);
    const user = upsertUserByTgId(ctx.from.id, [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(" "), ctx.from.username ?? null);
    await ctx.reply(
      `🆔 آی‌دی عددی شما:\n<code>${id}</code>\n\nاین عدد را در صفحه‌ی ورود Furina mind وارد کنید.\n\n👤 حساب شما در پیام‌رسان فعال شد: ${user.name}`,
      {
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [[{ text: "📋 کپی آی‌دی", copy_text: { text: id } }]],
        },
      }
    );
  });

  // /start — با پشتیبانی دیپ‌لینک و دعوت گروه
  b.command("start", async (ctx) => {
    if (!ctx.from) return;
    const payload = typeof ctx.match === "string" ? ctx.match.trim() : "";

    // دیپ‌لینک ورود
    if (payload.length >= 20 && !payload.startsWith("invite_") && deepLinkHandler) {
      const result = await deepLinkHandler(payload, ctx.from.id);
      await ctx.reply(result ?? "❌ لینک ورود نامعتبر یا منقضی است. دوباره از پیام‌رسان امتحان کنید.");
      return;
    }

    // دعوت گروه
    if (payload.startsWith("invite_")) {
      const token = payload.replace("invite_", "");
      const group = getGroupByInvite(token);
      if (!group) {
        await ctx.reply("❌ لینک دعوت نامعتبر است.");
        return;
      }
      const user = getUserByTgId(ctx.from.id);
      if (!user) {
        await ctx.reply("اول /id رو بزن تا اکانتت فعال شه، بعد دوباره لینک دعوت رو باز کن.");
        return;
      }
      if (isGroupMember(group.id, user.id)) {
        await ctx.reply(`✅ تو قبلاً عضو گروه «${group.name}» هستی!`);
      } else {
        addGroupMember(group.id, user.id);
        await ctx.reply(`🎉 به گروه «${group.name}» اضافه شدی! حالا تو پیام‌رسان می‌بینیش.`);
      }
      return;
    }

    const name = ctx.from.first_name ?? "";
    upsertUserByTgId(ctx.from.id, [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(" "), ctx.from.username ?? null);

    await ctx.reply(
      `سلام ${name}! 👋\n` +
        `این باتِ احراز هویت پیام‌رسان <b>Furina mind</b> است.\n\n` +
        `📝 برای ساخت اکانت:\n` +
        `۱. دستور /id را بفرست تا آی‌دی عددی‌ات را ببینی\n` +
        `۲. آن را در صفحه‌ی ورود پیام‌رسان وارد کن\n\n` +
        `📇 <b>ایمپورت مخاطبین:</b>\n` +
        `دکمه‌ی «📇 اشتراک مخاطب» پایین رو بزن تا مخاطبینت به Furina mind اضافه بشن.\n` +
        `یا دستور /contacts رو بزن تا لیست دوستات رو ببینی که بات رو استارت کردن.\n\n` +
        `👥 گروه و کانال هم از داخل پیام‌رسان می‌سازی، لینک دعوتش رو می‌تونی همین‌جا شیر کنی.`,
      {
        parse_mode: "HTML",
        reply_markup: {
          keyboard: [
            [{ text: "📇 اشتراک مخاطب", request_contact: true }],
            [{ text: "🆔 آی‌دی من" }, { text: "👥 مخاطبین من" }],
          ],
          resize_keyboard: true,
        },
      }
    );
  });

  // /contacts — لیست
  b.command("contacts", async (ctx) => {
    if (!ctx.from) return;
    const user = getUserByTgId(ctx.from.id);
    if (!user) {
      await ctx.reply("اول /id رو بزن تا اکانتت فعال شه.");
      return;
    }
    const contacts = listContacts(user.id).slice(0, 20);
    if (contacts.length === 0) {
      await ctx.reply("📭 هنوز مخاطبی اضافه نکردی. دکمه‌ی «📇 اشتراک مخاطب» رو بزن یا تو پیام‌رسان مخاطب اضافه کن.");
      return;
    }
    let txt = `📇 <b>${contacts.length} مخاطب آخر شما:</b>\n\n`;
    contacts.forEach((c, i) => {
      txt += `${i + 1}. ${c.name} ${c.phone ? `— <code>${c.phone}</code>` : ""} ${c.contact_user_id ? "✅ عضو Furina" : "⏳ هنوز عضو نشده"}\n`;
    });
    await ctx.reply(txt, { parse_mode: "HTML" });
  });

  // دکمه‌های کیبورد ساده
  b.hears("🆔 آی‌دی من", async (ctx) => {
    if (!ctx.from) return;
    const id = String(ctx.from.id);
    await ctx.reply(`🆔 آی‌دی شما: <code>${id}</code>`, {
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: [[{ text: "📋 کپی آی‌دی", copy_text: { text: id } }]] },
    });
  });

  b.hears("👥 مخاطبین من", async (ctx) => {
    if (!ctx.from) return;
    const user = getUserByTgId(ctx.from.id);
    if (!user) return;
    const contacts = listContacts(user.id);
    await ctx.reply(`📇 شما ${contacts.length} مخاطب در Furina mind داری. برای دیدن لیست /contacts رو بزن.`);
  });

  // هندل شیر کردن کانتکت — اصلی‌ترین بخش ایمپورت
  b.on(":contact", async (ctx) => {
    if (!ctx.from) return;
    const contact = ctx.message?.contact;
    if (!contact) return;
    try {
      const result = handleTelegramContactShare(ctx.from.id, {
        phone_number: contact.phone_number,
        first_name: contact.first_name,
        last_name: contact.last_name,
        user_id: contact.user_id,
      });

      let response = `✅ مخاطب <b>${result.contact.name}</b> اضافه شد!\n`;
      response += `📞 <code>${result.contact.phone}</code>\n`;
      if (result.linkedUser) {
        response += `\n🎉 این مخاطب عضو Furina mind هست! الان می‌تونی تو پیام‌رسان بهش پیام بدی.\n👤 ${result.linkedUser.name}`;
      } else {
        response += `\n⏳ این شماره هنوز عضو Furina نشده. لینک دعوت پیام‌رسان رو براش بفرست:\nhttps://t.me/${botUsername}?start=ref_${ctx.from.id}`;
        if (contact.user_id) {
          response += `\n\n(تلگرام آیدی‌ش رو داریم، به محض عضو شدن خودکار به مخاطبینت لینک میشه)`;
        }
      }
      await ctx.reply(response, { parse_mode: "HTML" });
    } catch (e) {
      console.error("[bot] contact share error", e);
      await ctx.reply("❌ خطا در ذخیره مخاطب. اول /id رو بزن بعد دوباره امتحان کن.");
    }
  });

  // هر پیام متنی دیگه
  b.on("message:text", async (ctx) => {
    const txt = ctx.message.text.trim().toLowerCase();
    if (txt.includes("سلام") || txt.includes("hi")) {
      await ctx.reply("سلام! 👋 /id رو بزن یا مخاطبت رو شیر کن 📇");
    } else {
      await ctx.reply("🤖 دستورهای موجود: /start , /id , /contacts\n📇 برای ایمپورت مخاطب، دکمه‌ی «📇 اشتراک مخاطب» رو بزن.", {
        reply_markup: {
          keyboard: [[{ text: "📇 اشتراک مخاطب", request_contact: true }], [{ text: "🆔 آی‌دی من" }, { text: "👥 مخاطبین من" }]],
          resize_keyboard: true,
        },
      });
    }
  });

  b.catch((err) => {
    console.error("[bot] خطا:", err.error);
  });

  b.start({
    onStart: () => console.log("[bot] دریافت آپدیت‌ها شروع شد (long polling)"),
  }).catch((e) => console.error("[bot] خطای long polling:", e));
}

export async function handleDeepLink(loginToken: string, tgId: number): Promise<string | null> {
  const res = await completeLogin(loginToken, { expectedTgId: tgId }, fetchProfile);
  if ("error" in res) return null;
  return `✅ ورود موفق!\nحالا به <b>Furina mind</b> برگرد؛ خودکار وارد می‌شوی.\n\n👤 نام: ${res.user.name || "—"}`;
}

export { fetchProfile };
