/* تست سرتاسری: دو کاربر، ورود، اتصال WebSocket، ارسال/دریافت، تایپینگ، خواندن */
"use strict";
process.chdir(require("path").resolve(__dirname, ".."));

const http = require("http");
const express = require("express");
const WebSocket = require("ws");
const { api } = require("../dist/api");
const { initWs } = require("../dist/ws");
const auth = require("../dist/auth");

const PORT = 3199;

function waitFor(pred, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const t = setInterval(() => {
      if (pred()) { clearInterval(t); resolve(); }
      else if (Date.now() - start > timeoutMs) { clearInterval(t); reject(new Error("timeout")); }
    }, 20);
  });
}

(async () => {
  let pass = 0, fail = 0;
  const check = (name, cond) => { console.log(`${cond ? "✅" : "❌"} ${name}`); cond ? pass++ : fail++; };

  // شبیه‌سازی ورود دو کاربر (کاری که بات انجام می‌دهد)
  async function fakeComplete(tgId, name) {
    const { loginToken, code } = auth.createLoginRequest(tgId);
    return auth.completeLogin(loginToken, { providedCode: code }, async () => ({
      name, username: name.toLowerCase(),
    }));
  }
  const A = await fakeComplete(111, "علی");
  const B = await fakeComplete(222, "رضا");
  check("دو کاربر ثبت‌نام شدند", !("error" in A) && !("error" in B));

  const app = express();
  app.use(express.json());
  app.use("/api", api);
  const server = http.createServer(app);
  initWs(server);
  await new Promise((r) => server.listen(PORT, "127.0.0.1", r));

  const wsA = new WebSocket(`ws://127.0.0.1:${PORT}/ws?token=${A.sessionToken}`);
  const wsB = new WebSocket(`ws://127.0.0.1:${PORT}/ws?token=${B.sessionToken}`);

  const got = { helloA: null, helloB: null, msgB: null, ackA: null, typingA: null, readA: null, presence: null };
  wsA.on("message", (d) => {
    const m = JSON.parse(d.toString());
    if (m.t === "hello") got.helloA = m;
    if (m.t === "msg" && m.ack) got.ackA = m;
    if (m.t === "typing") got.typingA = m;
    if (m.t === "read") got.readA = m;
    if (m.t === "presence") got.presence = m;
  });
  wsB.on("message", (d) => {
    const m = JSON.parse(d.toString());
    if (m.t === "hello") got.helloB = m;
    if (m.t === "msg" && !m.ack) got.msgB = m;
  });

  await waitFor(() => got.helloA && got.helloB);
  // بعد از فیکس حریم خصوصی، کاربر جدید به همه نشون داده نمیشه — فقط مخاطبین/هم‌گروهی‌ها/چت‌شده‌ها
  // پس در تست e2e که دو کاربر تازه‌اند و هنوز چتی نداشتن، لیست ممکنه ۰ باشه، اوکیه
  check("hello با فهرست کاربران و unread رسید", got.helloA && got.helloB && Array.isArray(got.helloA.users));

  // علی برای رضا پیام می‌فرستد
  wsA.send(JSON.stringify({ t: "msg", to: B.user.id, text: "سلام رضا!", temp: "TMP1" }));
  await waitFor(() => got.msgB && got.ackA);
  check("پیام به رضا رسید", got.msgB.text === "سلام رضا!" && got.msgB.from === A.user.id);
  check("تأیید (ack) با temp به علی رسید", got.ackA.temp === "TMP1" && got.ackA.id > 0);

  // رضا تایپ می‌کند
  wsB.send(JSON.stringify({ t: "typing", to: A.user.id }));
  await waitFor(() => got.typingA);
  check("نشانگر تایپینگ به علی رسید", got.typingA.from === B.user.id);

  // رضا تاریخچه را می‌گیرد (باید پیام‌ها خوانده شوند)
  const res = await fetch(`http://127.0.0.1:${PORT}/api/messages?with=${A.user.id}`, {
    headers: { Authorization: "Bearer " + B.sessionToken },
  });
  const hist = await res.json();
  check("تاریخچه شامل پیام است", hist.ok && hist.messages.length === 1 && hist.messages[0].text === "سلام رضا!");
  await waitFor(() => got.readA);
  check("اعلان خواندن به علی رسید", got.readA.by === B.user.id);

  // Saved Messages: علی برای خودش پیام می‌فرستد
  wsA.send(JSON.stringify({ t: "msg", to: A.user.id, text: "یادداشت شخصی من", temp: "TMP2" }));
  await waitFor(() => got.ackA && got.ackA.temp === "TMP2");
  check("پیام به خود (Saved) تأیید شد", got.ackA.id > 0 && got.ackA.to === A.user.id);

  const resSelf = await fetch(`http://127.0.0.1:${PORT}/api/messages?with=${A.user.id}`, {
    headers: { Authorization: "Bearer " + A.sessionToken },
  });
  const histSelf = await resSelf.json();
  check(
    "تاریخچه‌ی Saved شامل یادداشت است",
    histSelf.ok && histSelf.messages.some((m) => m.text === "یادداشت شخصی من" && m.read_at !== null)
  );

  // خروج رضا → presence آفلاین برای علی
  wsB.close();
  await waitFor(() => got.presence && got.presence.online === false);
  check("آفلاین شدن رضا اعلام شد", got.presence.id === B.user.id && typeof got.presence.last_seen === "number");

  wsA.close();
  server.close();
  console.log(`\nنتیجه: ${pass} موفق، ${fail} ناموفق`);
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => {
  console.error("خطای تست:", e);
  process.exit(1);
});
