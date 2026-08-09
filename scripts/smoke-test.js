/* تست دودِ منطق احراز هویت و دیتابیس — با stub موقت SQLite */
"use strict";
process.chdir(require("path").resolve(__dirname, ".."));

const db = require("../dist/db");
const auth = require("../dist/auth");

const fakeProfile = async () => ({ name: "کاربر تست", username: "testuser" });

(async () => {
  let pass = 0, fail = 0;
  const check = (name, cond) => {
    console.log(`${cond ? "✅" : "❌"} ${name}`);
    cond ? pass++ : fail++;
  };

  // ۱. ساخت درخواست ورود
  const { loginToken, code } = auth.createLoginRequest(123456789);
  check("کد ۵ رقمی ساخته شد", /^\d{5}$/.test(code));

  // ۲. کد اشتباه رد شود
  const wrong = await auth.completeLogin(loginToken, { providedCode: "00000" }, fakeProfile);
  check("کد اشتباه رد می‌شود", "error" in wrong && wrong.error === "wrong_code");

  // ۳. کد درست قبول شود
  const ok = await auth.completeLogin(loginToken, { providedCode: code }, fakeProfile);
  check("کد درست قبول می‌شود", !("error" in ok) && ok.user.tg_id === 123456789);

  // ۴. سشن معتبر است
  const u = auth.userByToken(ok.sessionToken);
  check("توکن سشن کاربر را برمی‌گرداند", u?.tg_id === 123456789);

  // ۵. تکرار روی کد مصرف‌شده همان توکن قبلی را می‌دهد (برای polling)
  const replay = await auth.completeLogin(loginToken, {}, fakeProfile);
  check("replay همان توکن را می‌دهد", !("error" in replay) && replay.sessionToken === ok.sessionToken);

  // ۶. کد منقضی رد شود
  const expired = auth.createLoginRequest(777);
  db.db.prepare("UPDATE auth_codes SET expires_at = ? WHERE login_token = ?").run(1, expired.loginToken);
  const exp = await auth.completeLogin(expired.loginToken, {}, fakeProfile);
  check("کد منقضی رد می‌شود", "error" in exp && exp.error === "expired");

  // ۷. درخواست جدید، کد قبلی همان آی‌دی را باطل کند
  const a1 = auth.createLoginRequest(888);
  auth.createLoginRequest(888);
  const stale = await auth.completeLogin(a1.loginToken, {}, fakeProfile);
  check("کد قدیمی بعد از درخواست جدید باطل است", "error" in stale && stale.error === "not_found");

  // ۸. ریت‌لیمیت: چهارمین تلاش در بازه رد شود
  const key = "rl-" + Date.now();
  auth.rateLimitOk("tg", key); auth.rateLimitOk("tg", key); auth.rateLimitOk("tg", key);
  check("ریت‌لیمیت چهارمین تلاش را رد می‌کند", auth.rateLimitOk("tg", key) === false);

  // ۹. پیام‌ها: ذخیره، تاریخچه، خوانده‌نشده، خواندن
  const bob = db.upsertUserByTgId(555, "باب", "bob");
  db.insertMessage(u.id, bob.id, "سلام");
  db.insertMessage(bob.id, u.id, "سلام، چطوری؟");
  check("تاریخچه دو پیام دارد", db.getHistory(u.id, bob.id).length === 2);
  check("خوانده‌نشده‌ها درست شمارش می‌شوند", db.unreadCounts(u.id)[bob.id] === 1);
  db.markRead(u.id, bob.id);
  check("بعد از خواندن، شمار صفر است", Object.keys(db.unreadCounts(u.id)).length === 0);

  console.log(`\nنتیجه: ${pass} موفق، ${fail} ناموفق`);
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
