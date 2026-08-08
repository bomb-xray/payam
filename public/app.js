"use strict";

/* پیام — کلاینت وب */

const $ = (id) => document.getElementById(id);

const state = {
  token: localStorage.getItem("payam_token") || null,
  me: null,
  users: new Map(),      // id -> user
  unread: new Map(),     // peerId -> count
  lastMsg: new Map(),    // peerId -> {text, ts, out}
  msgs: [],              // پیام‌های چت باز
  peer: null,            // آی‌دی کاربری که چتش باز است
  ws: null,
  wsRetry: 0,
  loginToken: null,
  countdown: 0,
  countdownTimer: null,
  pollTimer: null,
  pending: new Map(),    // tempId -> element حباب در انتظار تأیید
  typingUntil: 0,
  typingTimer: null,
  lastTypingSent: 0,
};

// ---------------------------------------------------------------------------
// ابزارها
// ---------------------------------------------------------------------------

const FA = "۰۱۲۳۴۵۶۷۸۹";
const fa = (s) => String(s).replace(/\d/g, (d) => FA[d]);
const fmtTime = (ts) =>
  new Intl.DateTimeFormat("fa-IR", { hour: "2-digit", minute: "2-digit" }).format(ts);
const fmtDate = (ts) => new Intl.DateTimeFormat("fa-IR", { dateStyle: "medium" }).format(ts);
const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();

const AVATAR_COLORS = ["#e17076", "#eda86c", "#a695e7", "#7bc862", "#6ec9cb", "#65aadd", "#ee7aae"];
function setAvatar(el, user) {
  el.textContent = (user.name || "؟").trim().charAt(0) || "؟";
  el.style.background = AVATAR_COLORS[user.id % AVATAR_COLORS.length];
}

async function api(path, opts = {}) {
  const headers = { "Content-Type": "application/json" };
  if (state.token) headers.Authorization = "Bearer " + state.token;
  const res = await fetch("/api" + path, { ...opts, headers });
  let data = {};
  try { data = await res.json(); } catch { /* ignore */ }
  if (!res.ok) {
    const e = new Error(data.message || data.error || "خطای ناشناخته");
    e.code = data.error;
    throw e;
  }
  return data;
}

function lastSeenText(u) {
  if (u.online) return "آنلاین";
  if (!u.last_seen) return "";
  const now = Date.now();
  if (sameDay(u.last_seen, now)) return `آخرین بازدید امروز، ${fmtTime(u.last_seen)}`;
  if (sameDay(u.last_seen, now - 86400000)) return `آخرین بازدید دیروز، ${fmtTime(u.last_seen)}`;
  return `آخرین بازدید ${fmtDate(u.last_seen)}`;
}

// ---------------------------------------------------------------------------
// ورود
// ---------------------------------------------------------------------------

async function showLogin() {
  $("login").classList.remove("hidden");
  $("app").classList.add("hidden");
  try {
    const c = await api("/config");
    if (c.bot) $("bot-username").textContent = c.bot;
  } catch { /* ignore */ }
}

function showStep(step) {
  $("login-step1").classList.toggle("hidden", step !== 1);
  $("login-step2").classList.toggle("hidden", step !== 2);
}

$("btn-request").addEventListener("click", async () => {
  const tgId = $("tg-id").value.trim();
  $("login-error").textContent = "";
  if (!/^\d+$/.test(tgId)) {
    $("login-error").textContent = "آی‌دی عددی وارد کنید — در بات دستور /id را بفرستید.";
    return;
  }
  $("btn-request").disabled = true;
  try {
    const r = await api("/auth/request", { method: "POST", body: JSON.stringify({ tg_id: tgId }) });
    state.loginToken = r.login_token;
    $("deep-link").href = r.deep_link;
    showStep(2);
    startCountdown(r.expires_in);
    startPolling();
    $("code").focus();
  } catch (e) {
    $("login-error").textContent = e.message;
  }
  $("btn-request").disabled = false;
});

$("tg-id").addEventListener("keydown", (e) => {
  if (e.key === "Enter") $("btn-request").click();
});

function startCountdown(seconds) {
  state.countdown = seconds;
  clearInterval(state.countdownTimer);
  const tick = () => {
    const m = Math.floor(state.countdown / 60);
    const s = state.countdown % 60;
    $("countdown").textContent = fa(`${m}:${String(s).padStart(2, "0")}`);
    if (state.countdown-- <= 0) {
      clearInterval(state.countdownTimer);
      $("verify-error").textContent = "کد منقضی شد. برگردید و دوباره درخواست دهید.";
    }
  };
  tick();
  state.countdownTimer = setInterval(tick, 1000);
}

function startPolling() {
  clearInterval(state.pollTimer);
  state.pollTimer = setInterval(async () => {
    if (!state.loginToken) return;
    try {
      const r = await api(`/auth/status?login_token=${encodeURIComponent(state.loginToken)}`);
      if (r.done && r.token) finishLogin(r.token);
      else if (r.expired) stopLoginFlow();
    } catch { /* ignore */ }
  }, 2500);
}

function stopLoginFlow() {
  clearInterval(state.pollTimer);
  clearInterval(state.countdownTimer);
}

$("btn-back").addEventListener("click", () => {
  stopLoginFlow();
  state.loginToken = null;
  $("code").value = "";
  $("verify-error").textContent = "";
  showStep(1);
});

$("btn-verify").addEventListener("click", async () => {
  const code = $("code").value.trim();
  $("verify-error").textContent = "";
  if (!/^\d{5}$/.test(code)) {
    $("verify-error").textContent = "کد باید ۵ رقم باشد.";
    return;
  }
  $("btn-verify").disabled = true;
  try {
    const r = await api("/auth/verify", {
      method: "POST",
      body: JSON.stringify({ login_token: state.loginToken, code }),
    });
    finishLogin(r.token);
  } catch (e) {
    $("verify-error").textContent = e.message;
  }
  $("btn-verify").disabled = false;
});

$("code").addEventListener("keydown", (e) => {
  if (e.key === "Enter") $("btn-verify").click();
});

function finishLogin(token) {
  stopLoginFlow();
  state.token = token;
  localStorage.setItem("payam_token", token);
  enterApp();
}

// ---------------------------------------------------------------------------
// برنامه‌ی اصلی
// ---------------------------------------------------------------------------

async function enterApp() {
  $("login").classList.add("hidden");
  $("app").classList.remove("hidden");
  try {
    const me = await api("/me");
    state.me = me.user;
  } catch {
    localStorage.removeItem("payam_token");
    state.token = null;
    showLogin();
    return;
  }
  $("me-name").textContent = state.me.name;
  $("me-username").textContent = state.me.username ? "@" + state.me.username : "";
  setAvatar($("me-avatar"), state.me);

  try {
    const r = await api("/users");
    state.users.clear();
    for (const u of r.users) state.users.set(u.id, u);
  } catch { /* ignore */ }

  renderSidebar();
  connectWs();
}

function setConn(on) {
  const el = $("conn-state");
  el.classList.toggle("on", on === true);
  el.classList.toggle("off", on === false);
}

function connectWs() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${location.host}/ws?token=${encodeURIComponent(state.token)}`);
  state.ws = ws;

  ws.onopen = () => {
    state.wsRetry = 0;
    setConn(true);
  };

  ws.onmessage = (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    handleEvent(msg);
  };

  ws.onclose = () => {
    setConn(false);
    const delay = Math.min(10000, 1000 * 2 ** state.wsRetry++);
    setTimeout(connectWs, delay);
  };
}

function wsSend(obj) {
  if (state.ws && state.ws.readyState === WebSocket.OPEN) {
    state.ws.send(JSON.stringify(obj));
  }
}

function handleEvent(msg) {
  switch (msg.t) {
    case "hello": {
      for (const u of msg.users) state.users.set(u.id, u);
      state.unread.clear();
      for (const [peer, count] of Object.entries(msg.unread)) {
        state.unread.set(Number(peer), count);
      }
      renderSidebar();
      if (state.peer) renderPeerStatus();
      break;
    }

    case "user": {
      state.users.set(msg.user.id, msg.user);
      renderSidebar();
      break;
    }

    case "presence": {
      const u = state.users.get(msg.id);
      if (u) {
        u.online = msg.online;
        if (msg.last_seen) u.last_seen = msg.last_seen;
        renderSidebar();
        if (state.peer === msg.id) renderPeerStatus();
      }
      break;
    }

    case "msg": {
      if (msg.ack) {
        onAck(msg);
      } else if (msg.from !== state.me.id) {
        state.lastMsg.set(msg.from, { text: msg.text, ts: msg.ts, out: false });
        if (state.peer === msg.from) {
          state.msgs.push(msg);
          appendBubble(msg);
          scrollDown();
          wsSend({ t: "read", peer: msg.from });
        } else {
          state.unread.set(msg.from, (state.unread.get(msg.from) || 0) + 1);
        }
        renderSidebar();
      }
      break;
    }

    case "typing": {
      if (state.peer === msg.from) showTyping();
      break;
    }

    case "read": {
      for (const m of state.msgs) {
        if (m.sender === state.me.id && m.recipient === msg.by) m.read_at = Date.now();
      }
      if (state.peer === msg.by) renderMessages();
      break;
    }

    case "pong":
      break;
  }
}

// ---------------------------------------------------------------------------
// سایدبار
// ---------------------------------------------------------------------------

function renderSidebar() {
  const list = $("user-list");
  const q = $("search").value.trim().toLowerCase();
  list.innerHTML = "";

  const users = [...state.users.values()]
    .filter((u) => !q || u.name.toLowerCase().includes(q) || (u.username || "").toLowerCase().includes(q))
    .sort((a, b) => {
      const ta = state.lastMsg.get(a.id)?.ts || a.created_at || 0;
      const tb = state.lastMsg.get(b.id)?.ts || b.created_at || 0;
      return tb - ta;
    });

  if (users.length === 0) {
    const empty = document.createElement("div");
    empty.className = "dim";
    empty.style.cssText = "text-align:center;padding:24px 12px;line-height:2";
    empty.textContent = q
      ? "نتیجه‌ای پیدا نشد"
      : "هنوز کاربر دیگری عضو نشده. دوستان‌تان را دعوت کنید! 🎉";
    list.appendChild(empty);
    return;
  }

  for (const u of users) {
    const item = document.createElement("div");
    item.className = "user-item" + (state.peer === u.id ? " active" : "");
    item.addEventListener("click", () => openChat(u.id));

    const avatar = document.createElement("div");
    avatar.className = "avatar";
    setAvatar(avatar, u);
    if (u.online) {
      const dot = document.createElement("span");
      dot.className = "online-dot";
      avatar.appendChild(dot);
    }

    const meta = document.createElement("div");
    meta.className = "user-meta";

    const top = document.createElement("div");
    top.className = "user-top";
    const name = document.createElement("div");
    name.className = "user-name";
    name.textContent = u.name || `کاربر ${u.id}`;
    const time = document.createElement("div");
    time.className = "user-time";
    const last = state.lastMsg.get(u.id);
    time.textContent = last ? fmtTime(last.ts) : "";
    top.append(name, time);

    const bottom = document.createElement("div");
    bottom.className = "user-bottom";
    const preview = document.createElement("div");
    preview.className = "user-preview";
    preview.textContent = last ? (last.out ? "شما: " : "") + last.text : lastSeenText(u);
    bottom.appendChild(preview);

    const unread = state.unread.get(u.id) || 0;
    if (unread > 0) {
      const badge = document.createElement("div");
      badge.className = "badge";
      badge.textContent = fa(unread);
      bottom.appendChild(badge);
    }

    meta.append(top, bottom);
    item.append(avatar, meta);
    list.appendChild(item);
  }
}

$("search").addEventListener("input", renderSidebar);

// ---------------------------------------------------------------------------
// چت
// ---------------------------------------------------------------------------

async function openChat(peerId) {
  const peer = state.users.get(peerId);
  if (!peer) return;
  state.peer = peerId;
  state.unread.set(peerId, 0);
  state.pending.clear();

  $("empty-state").classList.add("hidden");
  $("chat-view").classList.remove("hidden");
  $("app").classList.add("chat-open");

  $("peer-name").textContent = peer.name || `کاربر ${peer.id}`;
  setAvatar($("peer-avatar"), peer);
  renderPeerStatus();

  const box = $("messages");
  box.innerHTML = "";
  state.msgs = [];

  try {
    const r = await api(`/messages?with=${peerId}`);
    state.msgs = r.messages;
    if (r.messages.length > 0) state.lastMsg.set(peerId, {
      text: r.messages[r.messages.length - 1].text,
      ts: r.messages[r.messages.length - 1].ts,
      out: r.messages[r.messages.length - 1].sender === state.me.id,
    });
  } catch { /* ignore */ }

  renderMessages();
  renderSidebar();
  scrollDown(true);
  $("input").focus();
}

$("btn-back-chat").addEventListener("click", () => {
  state.peer = null;
  $("app").classList.remove("chat-open");
  $("chat-view").classList.add("hidden");
  $("empty-state").classList.remove("hidden");
  renderSidebar();
});

function renderPeerStatus() {
  const u = state.users.get(state.peer);
  if (!u) return;
  const el = $("peer-status");
  if (Date.now() < state.typingUntil) {
    el.textContent = "در حال نوشتن…";
    el.style.color = "var(--accent)";
  } else {
    el.textContent = lastSeenText(u);
    el.style.color = u.online ? "var(--accent)" : "";
  }
}

function showTyping() {
  state.typingUntil = Date.now() + 3000;
  renderPeerStatus();
  clearTimeout(state.typingTimer);
  state.typingTimer = setTimeout(renderPeerStatus, 3100);
}

function renderMessages() {
  const box = $("messages");
  box.innerHTML = "";
  let lastDay = null;
  for (const m of state.msgs) {
    if (!lastDay || !sameDay(m.ts, lastDay)) {
      const sep = document.createElement("div");
      sep.className = "day-sep";
      sep.textContent = sameDay(m.ts, Date.now()) ? "امروز" : fmtDate(m.ts);
      box.appendChild(sep);
      lastDay = m.ts;
    }
    box.appendChild(buildBubble(m));
  }
}

function buildBubble(m) {
  const out = m.sender === state.me.id;
  const el = document.createElement("div");
  el.className = `bubble ${out ? "out" : "in"}`;

  const text = document.createElement("span");
  text.textContent = m.text;

  const meta = document.createElement("span");
  meta.className = "meta";
  const time = document.createElement("span");
  time.textContent = fmtTime(m.ts);
  meta.appendChild(time);
  if (out) {
    const ticks = document.createElement("span");
    ticks.className = "ticks" + (m.read_at ? " read" : "");
    ticks.textContent = m.read_at ? "✓✓" : "✓";
    meta.appendChild(ticks);
  }

  el.append(text, meta);
  return el;
}

function appendBubble(m) {
  const box = $("messages");
  const last = box.lastElementChild;
  if (!last || !last.classList?.contains("bubble") || !sameDay(m.ts, Date.now())) {
    // ساده: اگر روز عوض شد جداکننده بزن
  }
  box.appendChild(buildBubble(m));
}

function scrollDown(force) {
  const box = $("messages");
  requestAnimationFrame(() => { box.scrollTop = box.scrollHeight; });
}

function onAck(msg) {
  const el = msg.temp ? state.pending.get(msg.temp) : null;
  if (el) {
    state.pending.delete(msg.temp);
    el.classList.remove("pending");
    const m = { id: msg.id, sender: state.me.id, recipient: msg.to, text: msg.text, ts: msg.ts, read_at: null };
    state.msgs.push(m);
    const fresh = buildBubble(m);
    el.replaceWith(fresh);
  } else if (msg.to === state.peer || state.msgs.some((x) => x.recipient === msg.to)) {
    // دستگاه دیگرِ خودمان فرستاده
    const m = { id: msg.id, sender: state.me.id, recipient: msg.to, text: msg.text, ts: msg.ts, read_at: null };
    state.msgs.push(m);
    if (msg.to === state.peer) {
      appendBubble(m);
      scrollDown();
    }
  }
  state.lastMsg.set(msg.to, { text: msg.text, ts: msg.ts, out: true });
  renderSidebar();
}

function sendMessage() {
  const input = $("input");
  const text = input.value.trim();
  if (!text || !state.peer) return;
  input.value = "";
  input.style.height = "auto";

  const temp = "t" + Date.now() + Math.random().toString(36).slice(2, 7);
  const optimistic = {
    id: -1, sender: state.me.id, recipient: state.peer, text, ts: Date.now(), read_at: null,
  };
  state.msgs.push(optimistic);
  const el = buildBubble(optimistic);
  el.classList.add("pending");
  $("messages").appendChild(el);
  state.pending.set(temp, el);
  scrollDown();

  state.lastMsg.set(state.peer, { text, ts: optimistic.ts, out: true });
  renderSidebar();

  wsSend({ t: "msg", to: state.peer, text, temp });
}

$("btn-send").addEventListener("click", sendMessage);

$("input").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

$("input").addEventListener("input", () => {
  const el = $("input");
  el.style.height = "auto";
  el.style.height = Math.min(el.scrollHeight, 130) + "px";
  const now = Date.now();
  if (state.peer && now - state.lastTypingSent > 2000) {
    state.lastTypingSent = now;
    wsSend({ t: "typing", to: state.peer });
  }
});

// ---------------------------------------------------------------------------
// خروج
// ---------------------------------------------------------------------------

$("btn-logout").addEventListener("click", async () => {
  try { await api("/logout", { method: "POST" }); } catch { /* ignore */ }
  localStorage.removeItem("payam_token");
  location.reload();
});

// ---------------------------------------------------------------------------
// شروع
// ---------------------------------------------------------------------------

(async function boot() {
  if (state.token) {
    try {
      await api("/me");
      enterApp();
      return;
    } catch {
      localStorage.removeItem("payam_token");
      state.token = null;
    }
  }
  showLogin();
})();
