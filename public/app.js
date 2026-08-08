"use strict";

/* Furina mind — کلاینت وب + ستینگ حرفه‌ای + فیکس حباب‌ها */

const $ = (id) => document.getElementById(id);

const state = {
  token: localStorage.getItem("payam_token") || null,
  me: null,
  users: new Map(),
  unread: new Map(),
  lastMsg: new Map(),
  msgs: [],
  peer: null,
  ws: null,
  wsRetry: 0,
  loginToken: null,
  countdown: 0,
  countdownTimer: null,
  pollTimer: null,
  pending: new Map(),
  typingUntil: 0,
  typingTimer: null,
  lastTypingSent: 0,
  // settings
  settings: null,
};

const SAVED_NAME = "ذخیره‌شده‌ها";
const isSavedId = (id) => state.me && id === state.me.id;

// ---------------------------------------------------------------------------
// تنظیمات — دیفالت و ذخیره
// ---------------------------------------------------------------------------

const DEFAULT_SETTINGS = {
  theme: "dark", // dark | amoled | light
  accent: "#3a86c8", // روشن‌تر — قبلا تیره بود
  fontSize: "medium", // small | medium | large | xlarge
  pattern: true,
  animations: true,
  compact: false,
  enterToSend: true,
  autoScroll: true,
  showSeconds: false,
  sendTyping: true,
  showAvatars: false,
  sound: true,
  desktopNotif: false,
  notifPreview: true,
  showUnreadBadge: true,
  showOnline: true,
  sendReadReceipts: true,
};

const ACCENT_PRESETS = [
  "#3a86c8", "#64b5ef", "#5288c1", "#2bbbad", "#4fae4e",
  "#e6a23c", "#e56555", "#a695e7", "#ee7aae", "#7bc862",
  "#6ec9cb", "#eda86c"
];

function loadSettings() {
  try {
    const raw = localStorage.getItem("payam_settings");
    const parsed = raw ? JSON.parse(raw) : {};
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch { return { ...DEFAULT_SETTINGS }; }
}
function saveSettings() {
  localStorage.setItem("payam_settings", JSON.stringify(state.settings));
}

state.settings = loadSettings();

function applySettings() {
  const s = state.settings;
  // theme
  document.documentElement.setAttribute("data-theme", s.theme);
  document.body.setAttribute("data-theme", s.theme);
  // accent
  document.documentElement.style.setProperty("--accent-2", s.accent);
  // generate lighter accent for --accent (just + lighter)
  // quick lightening: convert hex to rgb and bump
  const lighter = lightenColor(s.accent, 22);
  document.documentElement.style.setProperty("--accent", lighter);
  document.documentElement.style.setProperty("--accent-glow", hexToRgba(s.accent, 0.25));
  // font
  document.body.setAttribute("data-font", s.fontSize);
  // toggles -> classes
  document.body.classList.toggle("no-pattern", !s.pattern);
  document.body.classList.toggle("no-anim", !s.animations);
  document.body.classList.toggle("compact", !!s.compact);
  // update UI controls
  syncSettingsUI();
  // bubble font already via CSS var --msg-font
}

function lightenColor(hex, amt=20){
  try{
    let c = hex.replace(/^#/,"");
    if(c.length===3) c = c.split("").map(x=>x+x).join("");
    const num = parseInt(c,16);
    let r = (num>>16)+amt, g = ((num>>8)&0xFF)+amt, b = (num&0xFF)+amt;
    r=Math.min(255,Math.max(0,r)); g=Math.min(255,Math.max(0,g)); b=Math.min(255,Math.max(0,b));
    return `rgb(${r},${g},${b})`;
  }catch{ return hex; }
}
function hexToRgba(hex, a){
  try{
    let c=hex.replace(/^#/,"");
    if(c.length===3) c=c.split("").map(x=>x+x).join("");
    const num=parseInt(c,16);
    const r=num>>16, g=(num>>8)&0xFF, b=num&0xFF;
    return `rgba(${r},${g},${b},${a})`;
  }catch{ return `rgba(82,136,193,${a})`;}
}

function syncSettingsUI(){
  const s=state.settings;
  // theme cards
  document.querySelectorAll(".theme-card").forEach(el=>{
    el.classList.toggle("selected", el.dataset.theme===s.theme);
  });
  // accent
  document.querySelectorAll(".accent-dot").forEach(el=>{
    el.classList.toggle("selected", el.dataset.color===s.accent);
  });
  // toggles
  document.querySelectorAll(".toggle[data-key]").forEach(el=>{
    const k=el.dataset.key;
    // map keys to settings
    let val=false;
    if(k==="pattern") val=s.pattern;
    else if(k==="animations") val=s.animations;
    else if(k==="compact") val=s.compact;
    else if(k==="enterToSend") val=s.enterToSend;
    else if(k==="autoScroll") val=s.autoScroll;
    else if(k==="showSeconds") val=s.showSeconds;
    else if(k==="sendTyping") val=s.sendTyping;
    else if(k==="showAvatars") val=s.showAvatars;
    else if(k==="sound") val=s.sound;
    else if(k==="desktopNotif") val=s.desktopNotif;
    else if(k==="notifPreview"||k==="preview") val=s.notifPreview;
    else if(k==="showUnreadBadge") val=s.showUnreadBadge;
    else if(k==="showOnline") val=s.showOnline;
    else if(k==="sendReadReceipts") val=s.sendReadReceipts;
    else val = !!s[k];
    el.classList.toggle("on", !!val);
  });
  // font range
  const map = { small:0, medium:1, large:2, xlarge:3 };
  const rev = ["small","medium","large","xlarge"];
  const labels = { small:"کوچک", medium:"متوسط", large:"بزرگ", xlarge:"خیلی بزرگ" };
  const fr = $("font-range");
  if(fr){ fr.value = String(map[s.fontSize] ?? 1); const pill=$("font-pill"); if(pill) pill.textContent=labels[s.fontSize]||s.fontSize; }
}

function initSettingsUI(){
  // accent dots inject
  const row = $("accent-row");
  if(row && row.children.length===0){
    ACCENT_PRESETS.forEach(col=>{
      const d=document.createElement("button");
      d.className="accent-dot";
      d.dataset.color=col;
      d.style.background=col;
      d.title=col;
      d.addEventListener("click",()=>{
        state.settings.accent=col;
        saveSettings(); applySettings();
      });
      row.appendChild(d);
    });
  }
  // theme cards click
  document.querySelectorAll(".theme-card").forEach(el=>{
    el.addEventListener("click",()=>{
      state.settings.theme=el.dataset.theme || "dark";
      saveSettings(); applySettings();
    });
  });
  // toggles click
  document.querySelectorAll(".toggle[data-key]").forEach(el=>{
    el.addEventListener("click",()=>{
      const k=el.dataset.key;
      // toggle logic
      if(k==="pattern") state.settings.pattern=!state.settings.pattern;
      else if(k==="animations") state.settings.animations=!state.settings.animations;
      else if(k==="compact") state.settings.compact=!state.settings.compact;
      else if(k==="enterToSend") state.settings.enterToSend=!state.settings.enterToSend;
      else if(k==="autoScroll") state.settings.autoScroll=!state.settings.autoScroll;
      else if(k==="showSeconds") state.settings.showSeconds=!state.settings.showSeconds;
      else if(k==="sendTyping") state.settings.sendTyping=!state.settings.sendTyping;
      else if(k==="showAvatars") state.settings.showAvatars=!state.settings.showAvatars;
      else if(k==="sound") state.settings.sound=!state.settings.sound;
      else if(k==="desktopNotif") {
        // requires permission
        if(!state.settings.desktopNotif) {
          if(Notification && Notification.permission!=="granted"){
            Notification.requestPermission().then(p=>{
              if(p==="granted"){ state.settings.desktopNotif=true; }
              saveSettings(); applySettings();
            });
            return;
          }
        }
        state.settings.desktopNotif=!state.settings.desktopNotif;
      }
      else if(k==="notifPreview"||k==="preview") state.settings.notifPreview=!state.settings.notifPreview;
      else if(k==="showUnreadBadge") state.settings.showUnreadBadge=!state.settings.showUnreadBadge;
      else if(k==="showOnline") state.settings.showOnline=!state.settings.showOnline;
      else if(k==="sendReadReceipts") state.settings.sendReadReceipts=!state.settings.sendReadReceipts;
      saveSettings(); applySettings();
    });
  });
  // font range
  const fr=$("font-range");
  if(fr){
    fr.addEventListener("input",()=>{
      const rev=["small","medium","large","xlarge"];
      const idx=parseInt(fr.value)||1;
      state.settings.fontSize=rev[idx]||"medium";
      saveSettings(); applySettings();
    });
  }
  // settings nav tabs
  const nav=$("settings-nav");
  if(nav){
    nav.addEventListener("click",(e)=>{
      const btn=e.target.closest(".settings-nav-item");
      if(!btn) return;
      const tab=btn.dataset.tab;
      openSettingsTab(tab);
    });
  }
  // open/close
  $("btn-settings")?.addEventListener("click", openSettings);
  $("btn-close-settings")?.addEventListener("click", closeSettings);
  $("settings-backdrop")?.addEventListener("click", closeSettings);
  document.addEventListener("keydown",(e)=>{
    if(e.key==="Escape"){
      const m=$("settings-modal");
      if(m && !m.classList.contains("hidden")) closeSettings();
    }
  });
  // profile save
  $("btn-save-name")?.addEventListener("click", saveProfileName);
  $("set-name-input")?.addEventListener("keydown",(e)=>{ if(e.key==="Enter") saveProfileName(); });
  $("btn-copy-id")?.addEventListener("click",()=>{
    const txt = state.me ? String(state.me.id) : "";
    if(!txt) return;
    navigator.clipboard?.writeText(txt).then(()=> toast("آیدی کپی شد"));
  });
  // notifications permission button
  $("btn-req-notif")?.addEventListener("click", async ()=>{
    if(!("Notification" in window)){ alert("مرورگر شما اعلان را پشتیبانی نمی‌کند"); return; }
    const p=await Notification.requestPermission();
    if(p==="granted"){ state.settings.desktopNotif=true; saveSettings(); applySettings(); toast("اعلان فعال شد ✅"); }
    else toast("مجوز داده نشد");
  });
  // sessions
  $("btn-revoke-others")?.addEventListener("click", revokeOtherSessions);
  // data
  $("btn-export")?.addEventListener("click", exportChats);
  $("btn-clear-pending")?.addEventListener("click", ()=>{ state.pending.clear(); toast("موقت‌ها پاک شد"); });
  $("btn-clear-all")?.addEventListener("click", ()=>{
    if(!confirm("همه داده محلی (تنظیمات + توکن) پاک شود؟ بعدش باید دوباره ورود کنی.")) return;
    localStorage.clear(); location.reload();
  });
  $("btn-reload")?.addEventListener("click", ()=>{
    state.ws?.close(); toast("در حال اتصال مجدد…"); setTimeout(()=> connectWs(), 400);
  });
}

function toast(msg){
  // simple console + show in profile status etc
  console.log("[toast]", msg);
  const el=$("set-name-status") || $("sessions-status");
  if(el){ el.textContent=msg; setTimeout(()=>{ if(el.textContent===msg) el.textContent=""; }, 2500); }
}

function openSettings(initialTab){
  const m=$("settings-modal");
  if(!m) return;
  m.classList.remove("hidden");
  if(initialTab) openSettingsTab(initialTab);
  refreshSettingsData();
}

function closeSettings(){
  $("settings-modal")?.classList.add("hidden");
}

function openSettingsTab(tab){
  document.querySelectorAll(".settings-nav-item").forEach(el=>{
    el.classList.toggle("active", el.dataset.tab===tab);
  });
  document.querySelectorAll(".settings-tab").forEach(el=>{
    el.classList.toggle("active", el.dataset.tabContent===tab);
  });
}

// ---------------------------------------------------------------------------
// ابزارها
// ---------------------------------------------------------------------------
const FA = "۰۱۲۳۴۵۶۷۸۹";
const fa = (s) => String(s).replace(/\d/g, (d) => FA[d]);
const fmtTime = (ts, withSec=false) => {
  const opts = withSec ? { hour:"2-digit", minute:"2-digit", second:"2-digit"} : { hour:"2-digit", minute:"2-digit"};
  return new Intl.DateTimeFormat("fa-IR", opts).format(ts);
};
const fmtDate = (ts) => new Intl.DateTimeFormat("fa-IR", { dateStyle: "medium" }).format(ts);
const fmtDateTime = (ts) => new Intl.DateTimeFormat("fa-IR", { dateStyle:"short", timeStyle:"medium"}).format(ts);
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
  try { data = await res.json(); } catch { }
  if (!res.ok) {
    const e = new Error(data.message || data.error || "خطای ناشناخته");
    e.code = data.error;
    throw e;
  }
  return data;
}

function lastSeenText(u) {
  if(!state.settings.showOnline) return "";
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
    if($("about-bot")) $("about-bot").textContent = `🤖 بات: ${c.bot || "…"}`;
  } catch { }
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
    } catch { }
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
  } catch { }

  // --- سیستم ابری: گرفتن آخرین پیام هر چت تا بعد رفرش پاک نشه ---
  try{
    const conv = await api("/conversations");
    state.lastMsg.clear();
    for(const [peerId, msg] of Object.entries(conv.last)){
      const id = Number(peerId);
      if(!msg) continue;
      state.lastMsg.set(id, { text: msg.text, ts: msg.ts, out: msg.sender === state.me.id });
    }
    // اگر پیام ذخیره‌شده‌ها (به خود) هم هست
    if(conv.last[state.me.id]){
      const m=conv.last[state.me.id];
      state.lastMsg.set(state.me.id, { text: m.text, ts: m.ts, out: true });
    }
  }catch(e){ console.warn("conv fetch fail", e); }

  renderSidebar();
  connectWs();
  refreshSettingsData();
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
      // اگر بک‌اند last فرستاد (سیستم ابری)
      if (msg.last) {
        for (const [peerId, m] of Object.entries(msg.last)) {
          const id = Number(peerId);
          if (!m) continue;
          state.lastMsg.set(id, { text: m.text, ts: m.ts, out: m.sender === state.me.id });
        }
      }
      renderSidebar();
      if (state.peer) renderPeerStatus();
      updateTitleBadge();
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
      } else {
        const isSelfCloud = msg.from === state.me.id && msg.to === state.me.id;
        const isFromOther = msg.from !== state.me.id;
        if (isFromOther || isSelfCloud) {
          // جلوگیری از دوبار اضافه شدن اگر همین آیدی رو داریم
          if (state.msgs.some(m=>m.id===msg.id)) break;
          const isOutSelf = isSelfCloud;
          state.lastMsg.set(isOutSelf ? msg.to : msg.from, { text: msg.text, ts: msg.ts, out: isOutSelf });
          const isOpen = state.peer === (isOutSelf ? msg.to : msg.from) || (isSelfCloud && isSavedId(state.peer));
          if (isOpen) {
            state.msgs.push({ id: msg.id, sender: msg.from, recipient: msg.to, text: msg.text, ts: msg.ts, read_at: msg.read ? Date.now() : null });
            appendBubble(state.msgs[state.msgs.length-1]);
            scrollDown();
            if(isFromOther && state.settings.sendReadReceipts) wsSend({ t: "read", peer: msg.from });
          } else if(isFromOther) {
            state.unread.set(msg.from, (state.unread.get(msg.from) || 0) + 1);
            playSound();
            notifyDesktop(msg);
          }
          renderSidebar();
          updateTitleBadge();
        }
      }
      break;
    }
    case "typing": {
      if (state.peer === msg.from && msg.from !== state.me.id) showTyping();
      break;
    }
    case "read": {
      for (const m of state.msgs) {
        if (m.sender === state.me.id && m.recipient === msg.by) m.read_at = Date.now();
      }
      if (state.peer === msg.by) renderMessages();
      break;
    }
    case "pong": break;
  }
}

// صدا
let audioCtx=null;
function playSound(){
  if(!state.settings.sound) return;
  try{
    if(!audioCtx) audioCtx = new (window.AudioContext||window.webkitAudioContext)();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type="sine"; o.frequency.value=880;
    g.gain.value=0.06;
    o.connect(g); g.connect(audioCtx.destination);
    o.start(); g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime+0.35);
    setTimeout(()=>{ try{o.stop()}catch{} }, 350);
  }catch{}
}
function notifyDesktop(msg){
  if(!state.settings.desktopNotif) return;
  if(!("Notification" in window) || Notification.permission!=="granted") return;
  if(document.visibilityState==="visible" && state.peer===msg.from) return;
  const fromUser = state.users.get(msg.from);
  const title = fromUser ? fromUser.name : "پیام جدید";
  const body = state.settings.notifPreview ? msg.text.slice(0,120) : "پیام جدید دارید";
  try{ new Notification(title, { body, icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🌊</text></svg>" }); }catch{}
}
function updateTitleBadge(){
  if(!state.settings.showUnreadBadge){
    document.title="Furina mind";
    return;
  }
  let total=0;
  for(const v of state.unread.values()) total+=v;
  if(total>0) document.title=`(${fa(total)}) Furina mind`;
  else document.title="Furina mind";
}

// ---------------------------------------------------------------------------
// سایدبار
// ---------------------------------------------------------------------------
function buildConvItem(u, opts = {}) {
  const saved = !!opts.saved;
  const item = document.createElement("div");
  item.className = "user-item" + (state.peer === u.id ? " active" : "");
  item.addEventListener("click", () => openChat(u.id));

  const avatar = document.createElement("div");
  avatar.className = "avatar";
  if (saved) {
    avatar.textContent = "🔖";
    avatar.style.background = "linear-gradient(135deg, #2b5278, #64b5ef)";
  } else {
    setAvatar(avatar, u);
    if (u.online && state.settings.showOnline) {
      const dot = document.createElement("span");
      dot.className = "online-dot";
      avatar.appendChild(dot);
    }
  }

  const meta = document.createElement("div");
  meta.className = "user-meta";
  const last = state.lastMsg.get(u.id);
  const top = document.createElement("div");
  top.className = "user-top";
  const name = document.createElement("div");
  name.className = "user-name";
  name.textContent = saved ? SAVED_NAME : u.name || `کاربر ${u.id}`;
  const time = document.createElement("div");
  time.className = "user-time";
  time.textContent = last ? fmtTime(last.ts, state.settings.showSeconds) : "";
  top.append(name, time);

  const bottom = document.createElement("div");
  bottom.className = "user-bottom";
  const preview = document.createElement("div");
  preview.className = "user-preview";
  preview.textContent = last ? (last.out ? "شما: " : "") + last.text : saved ? "یادداشت‌های ذخیره‌شده‌ی شما" : lastSeenText(u);
  bottom.appendChild(preview);
  const unread = saved ? 0 : state.unread.get(u.id) || 0;
  if (unread > 0) {
    const badge = document.createElement("div");
    badge.className = "badge";
    badge.textContent = fa(unread);
    bottom.appendChild(badge);
  }
  meta.append(top, bottom);
  item.append(avatar, meta);
  return item;
}

function renderSidebar() {
  const list = $("user-list");
  const q = $("search").value.trim().toLowerCase();
  list.innerHTML = "";
  const savedMatches = state.me && (!q || SAVED_NAME.includes(q) || "saved".includes(q));
  const users = [...state.users.values()].filter((u) => !q || u.name.toLowerCase().includes(q) || (u.username || "").toLowerCase().includes(q)).sort((a, b) => {
    const ta = state.lastMsg.get(a.id)?.ts || 0;
    const tb = state.lastMsg.get(b.id)?.ts || 0;
    return tb - ta;
  });
  if (savedMatches) {
    list.appendChild(buildConvItem({ id: state.me.id }, { saved: true }));
  }
  for (const u of users) list.appendChild(buildConvItem(u));
  if (!savedMatches && users.length === 0) {
    const empty = document.createElement("div");
    empty.className = "dim";
    empty.style.cssText = "text-align:center;padding:24px 12px;line-height:2";
    empty.textContent = "نتیجه‌ای پیدا نشد";
    list.appendChild(empty);
  } else if (!q && users.length === 0) {
    const hint = document.createElement("div");
    hint.className = "dim";
    hint.style.cssText = "text-align:center;padding:24px 12px;line-height:2";
    hint.textContent = "هنوز کاربر دیگری عضو نشده. دوستان‌تان را دعوت کنید! 🎉";
    list.appendChild(hint);
  }
}
$("search").addEventListener("input", renderSidebar);

// ---------------------------------------------------------------------------
// چت — با فیکس LTR container و راست‌چین پیام من
// ---------------------------------------------------------------------------
async function openChat(peerId) {
  const saved = isSavedId(peerId);
  const peer = saved ? state.me : state.users.get(peerId);
  if (!peer) return;
  state.peer = peerId;
  state.unread.set(peerId, 0);
  state.pending.clear();

  $("empty-state").classList.add("hidden");
  $("chat-view").classList.remove("hidden");
  $("app").classList.add("chat-open");

  $("peer-name").textContent = saved ? SAVED_NAME : peer.name || `کاربر ${peer.id}`;
  const avatarEl = $("peer-avatar");
  if (saved) {
    avatarEl.textContent = "🔖";
    avatarEl.style.background = "linear-gradient(135deg, #2b5278, #64b5ef)";
  } else {
    avatarEl.style.background = "";
    setAvatar(avatarEl, peer);
  }
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
  } catch { }

  renderMessages();
  renderSidebar();
  scrollDown(true);
  updateTitleBadge();
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
  const el = $("peer-status");
  if (isSavedId(state.peer)) {
    el.textContent = "☁️ یادداشت‌های شخصی شما — فقط خودتان آن‌ها را می‌بینید";
    el.style.color = "";
    return;
  }
  const u = state.users.get(state.peer);
  if (!u) return;
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
  el.className = `bubble ${out ? "out" : "in"}` + (isSavedId(m.recipient) && out ? " saved-self" : "");
  const text = document.createElement("span");
  text.textContent = m.text;
  const meta = document.createElement("span");
  meta.className = "meta";
  const time = document.createElement("span");
  time.textContent = fmtTime(m.ts, state.settings.showSeconds);
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
  box.appendChild(buildBubble(m));
}

function scrollDown(force) {
  if(!force && !state.settings.autoScroll) return;
  const box = $("messages");
  requestAnimationFrame(() => { box.scrollTop = box.scrollHeight; });
}

function onAck(msg) {
  const el = msg.temp ? state.pending.get(msg.temp) : null;
  if (el) {
    state.pending.delete(msg.temp);
    // حذف پیام خوش‌بینانه id=-1 از آرایه و جایگزینی با پیام واقعی
    const idx = state.msgs.findIndex(x => x.id === -1 && x.text === msg.text && x.recipient === msg.to);
    const m = { id: msg.id, sender: state.me.id, recipient: msg.to, text: msg.text, ts: msg.ts, read_at: isSavedId(msg.to) ? Date.now() : null };
    if (idx !== -1) state.msgs[idx] = m;
    else state.msgs.push(m);
    const fresh = buildBubble(m);
    fresh.classList.remove("pending");
    el.replaceWith(fresh);
  } else {
    // اگر temp نداشتیم (مثلاً از تب دیگر یا fallback HTTP) — بررسی تکراری نبودن
    if (state.msgs.some(x => x.id === msg.id)) {
      // تکراری
    } else if (msg.to === state.peer || isSavedId(msg.to) || state.msgs.some((x) => x.recipient === msg.to)) {
      const m = { id: msg.id, sender: state.me.id, recipient: msg.to, text: msg.text, ts: msg.ts, read_at: isSavedId(msg.to) ? Date.now() : null };
      state.msgs.push(m);
      if (msg.to === state.peer) {
        appendBubble(m);
        scrollDown();
      }
    }
  }
  state.lastMsg.set(msg.to, { text: msg.text, ts: msg.ts, out: true });
  renderSidebar();
}

async function sendMessage() {
  const input = $("input");
  const text = input.value.trim();
  if (!text || !state.peer) return;
  input.value = "";
  input.style.height = "auto";
  const temp = "t" + Date.now() + Math.random().toString(36).slice(2, 7);
  const optimistic = { id: -1, sender: state.me.id, recipient: state.peer, text, ts: Date.now(), read_at: null };
  state.msgs.push(optimistic);
  const el = buildBubble(optimistic);
  el.classList.add("pending");
  $("messages").appendChild(el);
  state.pending.set(temp, el);
  scrollDown(true);
  state.lastMsg.set(state.peer, { text, ts: optimistic.ts, out: true });
  renderSidebar();

  let acked = false;
  const checkAck = () => {
    if (state.pending.has(temp)) {
      // هنوز ack نیومده — تلاش HTTP fallback
      console.warn("[send] WS ack timeout, trying HTTP fallback for", temp);
      api("/messages", { method: "POST", body: JSON.stringify({ to: state.peer, text }) })
        .then(r => {
          if (!state.pending.has(temp)) return;
          // شبیه ack رفتار کن
          onAck({ id: r.message.id, to: state.peer, text: r.message.text, ts: r.message.ts, temp });
          acked = true;
        })
        .catch(e => {
          console.error("HTTP fallback failed", e);
          // اگر بازم نشد، pending رو قرمز کن
          const pend = state.pending.get(temp);
          if (pend) {
            pend.style.border = "1px solid #e56555";
            pend.title = "ارسال ناموفق — دوباره تلاش کن";
          }
        });
    }
  };

  wsSend({ t: "msg", to: state.peer, text, temp });

  // اگر بعد 2.5 ثانیه ack نیومد، fallback
  setTimeout(() => {
    if (!acked && state.pending.has(temp)) checkAck();
  }, 2500);
}

$("btn-send").addEventListener("click", sendMessage);
$("btn-chat-info")?.addEventListener("click", ()=> openSettings("profile"));

$("input").addEventListener("keydown", (e) => {
  const enterToSend = state.settings.enterToSend;
  if (e.key === "Enter" && (enterToSend ? !e.shiftKey : (e.ctrlKey||e.metaKey))) {
    e.preventDefault();
    sendMessage();
  }
});
$("input").addEventListener("input", () => {
  const el = $("input");
  el.style.height = "auto";
  el.style.height = Math.min(el.scrollHeight, 160) + "px";
  const now = Date.now();
  if (state.peer && !isSavedId(state.peer) && state.settings.sendTyping && now - state.lastTypingSent > 2000) {
    state.lastTypingSent = now;
    wsSend({ t: "typing", to: state.peer });
  }
});

// ---------------------------------------------------------------------------
// پروفایل و ستینگ دیتا
// ---------------------------------------------------------------------------
async function refreshSettingsData(){
  if(!state.me) return;
  // avatar big
  const big=$("set-avatar-big");
  if(big){ setAvatar(big, state.me); big.textContent=(state.me.name||"?").trim().charAt(0)||"?"; }
  $("set-profile-name") && ($("set-profile-name").textContent=state.me.name||"—");
  $("set-profile-sub") && ($("set-profile-sub").textContent= state.me.username ? "@"+state.me.username : `ID ${state.me.id}`);
  $("set-name-input") && ($("set-name-input").value=state.me.name||"");
  $("set-info-id") && ($("set-info-id").textContent=String(state.me.id));
  $("set-info-tgid") && ($("set-info-tgid").textContent=String(state.me.tg_id||"—"));
  $("set-info-username") && ($("set-info-username").textContent= state.me.username ? "@"+state.me.username : "ندارد");
  $("set-info-joined") && ($("set-info-joined").textContent= state.me.created_at ? fmtDateTime(state.me.created_at) : "—");
  // sessions
  loadSessions();
  // storage
  calcStorage();
  // uptime
  try{
    const h=await api("/health");
    if($("about-uptime")) $("about-uptime").textContent = Math.floor(h.uptime/60)+"m";
  }catch{}
}

async function saveProfileName(){
  const inp=$("set-name-input");
  const status=$("set-name-status");
  if(!inp) return;
  const name=inp.value.trim();
  if(name.length<2){ if(status) status.textContent="نام کوتاه است"; return; }
  if(status) status.textContent="در حال ذخیره…";
  try{
    const r=await api("/me", { method:"PUT", body: JSON.stringify({ name }) });
    state.me=r.user;
    $("me-name").textContent=state.me.name;
    setAvatar($("me-avatar"), state.me);
    const big=$("set-avatar-big"); if(big) setAvatar(big, state.me);
    $("set-profile-name").textContent=state.me.name;
    status.textContent="✅ ذخیره شد";
    renderSidebar();
    setTimeout(()=>{ status.textContent=""; }, 2000);
  }catch(e){ status.textContent="خطا: "+e.message; }
}

async function loadSessions(){
  const list=$("sessions-list");
  if(!list) return;
  list.textContent="در حال بارگذاری…";
  try{
    const r=await api("/sessions");
    list.innerHTML="";
    if(r.sessions.length===0){
      list.textContent="نشستی یافت نشد";
      return;
    }
    r.sessions.forEach(s=>{
      const item=document.createElement("div");
      item.className="session-item"+(s.current?" current":"");
      const meta=document.createElement("div");
      meta.className="session-meta";
      const title=document.createElement("div");
      title.className="session-title";
      title.textContent=s.current ? "این دستگاه — نشست فعلی" : `نشست ${s.preview}…`;
      const time=document.createElement("div");
      time.className="session-time";
      time.textContent=fmtDateTime(s.created_at);
      meta.append(title,time);
      const badge=document.createElement("div");
      if(s.current){ badge.className="session-badge"; badge.textContent="فعلی"; }
      item.append(meta,badge);
      list.appendChild(item);
    });
  }catch(e){ list.textContent="خطا در بارگذاری"; }
}

async function revokeOtherSessions(){
  const st=$("sessions-status");
  if(!confirm("از تمام دستگاه‌های دیگر خارج شوی؟")) return;
  if(st) st.textContent="در حال خروج…";
  try{
    const r=await api("/sessions/revoke-others", { method:"POST" });
    if(st) st.textContent=`✅ ${fa(r.revoked)} نشست بسته شد`;
    loadSessions();
  }catch(e){ if(st) st.textContent="خطا: "+e.message; }
}

function calcStorage(){
  const txt=$("storage-text");
  const fill=$("storage-fill");
  try{
    let total=0;
    for(let i=0;i<localStorage.length;i++){
      const k=localStorage.key(i);
      const v=localStorage.getItem(k) || "";
      total+=k.length+v.length;
    }
    const kb=(total/1024).toFixed(1);
    const pct=Math.min(100, (total/ (5*1024*1024))*100);
    if(txt) txt.textContent=`حدود ${kb} KB از 5MB استفاده شده (localStorage)`;
    if(fill) fill.style.width=pct+"%";
  }catch{
    if(txt) txt.textContent="قابل محاسبه نیست";
  }
}

async function exportChats(){
  try{
    const r = await api("/export");
    const blob=new Blob([JSON.stringify(r,null,2)], {type:"application/json"});
    const url=URL.createObjectURL(blob);
    const a=document.createElement("a");
    a.href=url; a.download=`furina-cloud-export-${Date.now()}.json`; a.click();
    setTimeout(()=>URL.revokeObjectURL(url), 2000);
    toast("✅ خروجی ابری دانلود شد — همه پیام‌ها توی سروره");
  }catch{
    // fallback local
    const data={
      exported_at: Date.now(),
      me: state.me,
      users: [...state.users.values()],
      messages: state.msgs,
      lastMsg: [...state.lastMsg.entries()],
      unread: [...state.unread.entries()],
    };
    const blob=new Blob([JSON.stringify(data,null,2)], {type:"application/json"});
    const url=URL.createObjectURL(blob);
    const a=document.createElement("a");
    a.href=url; a.download=`furina-export-${Date.now()}.json`; a.click();
    setTimeout(()=>URL.revokeObjectURL(url), 2000);
    toast("خروجی محلی دانلود شد");
  }
}

// ---------------------------------------------------------------------------
// خروج
// ---------------------------------------------------------------------------
$("btn-logout").addEventListener("click", async () => {
  try { await api("/logout", { method: "POST" }); } catch { }
  localStorage.removeItem("payam_token");
  location.reload();
});

// ---------------------------------------------------------------------------
// شروع
// ---------------------------------------------------------------------------
(function boot(){
  applySettings();
  initSettingsUI();
  if (state.token) {
    api("/me").then(()=> enterApp()).catch(()=>{
      localStorage.removeItem("payam_token");
      state.token = null;
      showLogin();
    });
    return;
  }
  showLogin();
})();
