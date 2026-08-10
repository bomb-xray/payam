"use strict";

/* Furina mind v0.3 — گروه، کانال، مخاطبین + ایمپورت از بات تلگرام + فیکس ابری */

const $ = (id) => document.getElementById(id);

const state = {
  token: localStorage.getItem("payam_token") || null,
  me: null,
  users: new Map(),
  groups: new Map(), // id -> group
  contacts: new Map(), // id -> contact
  unread: new Map(), // private peerId -> count
  unreadGroups: new Map(), // groupId -> count
  lastMsg: new Map(), // private
  lastGroupMsg: new Map(), // groupId -> {text, ts, from, out}
  msgs: [],
  peer: null, // private chat id
  group: null, // group chat id
  activeTab: "all", // all | chats | groups | channels | contacts
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
  settings: null,
};

const SAVED_NAME = "ذخیره‌شده‌ها";
const isSavedId = (id) => state.me && id === state.me.id;

// ---------------------------------------------------------------------------
// تنظیمات
// ---------------------------------------------------------------------------
const DEFAULT_SETTINGS = {
  theme: "dark",
  accent: "#3a86c8",
  fontSize: "medium",
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
const ACCENT_PRESETS = ["#3a86c8","#64b5ef","#5288c1","#2bbbad","#4fae4e","#e6a23c","#e56555","#a695e7","#ee7aae","#7bc862","#6ec9cb","#eda86c"];

function loadSettings(){ try{ const raw=localStorage.getItem("payam_settings"); const p=raw?JSON.parse(raw):{}; return {...DEFAULT_SETTINGS, ...p}; }catch{ return {...DEFAULT_SETTINGS}; } }
function saveSettings(){ localStorage.setItem("payam_settings", JSON.stringify(state.settings)); }
state.settings = loadSettings();

function lightenColor(hex, amt=20){
  try{ let c=hex.replace(/^#/,""); if(c.length===3) c=c.split("").map(x=>x+x).join(""); const n=parseInt(c,16); let r=(n>>16)+amt,g=((n>>8)&0xFF)+amt,b=(n&0xFF)+amt; r=Math.min(255,Math.max(0,r)); g=Math.min(255,Math.max(0,g)); b=Math.min(255,Math.max(0,b)); return `rgb(${r},${g},${b})`; }catch{ return hex; }
}
function hexToRgba(hex,a){ try{ let c=hex.replace(/^#/,""); if(c.length===3) c=c.split("").map(x=>x+x).join(""); const n=parseInt(c,16); return `rgba(${n>>16},${(n>>8)&0xFF},${n&0xFF},${a})`; }catch{ return `rgba(58,134,200,${a})`; } }

function applySettings(){
  const s=state.settings;
  document.documentElement.setAttribute("data-theme", s.theme);
  document.body.setAttribute("data-theme", s.theme);
  document.documentElement.style.setProperty("--accent-2", s.accent);
  document.documentElement.style.setProperty("--accent", lightenColor(s.accent, 22));
  document.documentElement.style.setProperty("--accent-glow", hexToRgba(s.accent, 0.25));
  document.body.setAttribute("data-font", s.fontSize);
  document.body.classList.toggle("no-pattern", !s.pattern);
  document.body.classList.toggle("no-anim", !s.animations);
  document.body.classList.toggle("compact", !!s.compact);
  syncSettingsUI();
}
function syncSettingsUI(){
  const s=state.settings;
  document.querySelectorAll(".theme-card").forEach(el=> el.classList.toggle("selected", el.dataset.theme===s.theme));
  document.querySelectorAll(".accent-dot").forEach(el=> el.classList.toggle("selected", el.dataset.color===s.accent));
  document.querySelectorAll(".toggle[data-key]").forEach(el=>{
    const k=el.dataset.key;
    let v=false;
    if(k==="pattern") v=s.pattern;
    else if(k==="animations") v=s.animations;
    else if(k==="compact") v=s.compact;
    else if(k==="enterToSend") v=s.enterToSend;
    else if(k==="autoScroll") v=s.autoScroll;
    else if(k==="showSeconds") v=s.showSeconds;
    else if(k==="sendTyping") v=s.sendTyping;
    else if(k==="showAvatars") v=s.showAvatars;
    else if(k==="sound") v=s.sound;
    else if(k==="desktopNotif") v=s.desktopNotif;
    else if(k==="notifPreview") v=s.notifPreview;
    else if(k==="showUnreadBadge") v=s.showUnreadBadge;
    else if(k==="showOnline") v=s.showOnline;
    else if(k==="sendReadReceipts") v=s.sendReadReceipts;
    else v=!!s[k];
    el.classList.toggle("on", !!v);
  });
  const map={small:0,medium:1,large:2,xlarge:3};
  const labels={small:"کوچک",medium:"متوسط",large:"بزرگ",xlarge:"خیلی بزرگ"};
  const fr=$("font-range"); if(fr){ fr.value=String(map[s.fontSize]??1); const pill=$("font-pill"); if(pill) pill.textContent=labels[s.fontSize]||s.fontSize; }
}
function initSettingsUI(){
  const row=$("accent-row");
  if(row && row.children.length===0){
    ACCENT_PRESETS.forEach(col=>{ const d=document.createElement("button"); d.className="accent-dot"; d.dataset.color=col; d.style.background=col; d.addEventListener("click",()=>{ state.settings.accent=col; saveSettings(); applySettings(); }); row.appendChild(d); });
  }
  document.querySelectorAll(".theme-card").forEach(el=> el.addEventListener("click",()=>{ state.settings.theme=el.dataset.theme||"dark"; saveSettings(); applySettings(); }));
  document.querySelectorAll(".toggle[data-key]").forEach(el=> el.addEventListener("click",()=>{
    const k=el.dataset.key;
    if(k==="pattern") state.settings.pattern=!state.settings.pattern;
    else if(k==="animations") state.settings.animations=!state.settings.animations;
    else if(k==="compact") state.settings.compact=!state.settings.compact;
    else if(k==="enterToSend") state.settings.enterToSend=!state.settings.enterToSend;
    else if(k==="autoScroll") state.settings.autoScroll=!state.settings.autoScroll;
    else if(k==="showSeconds") state.settings.showSeconds=!state.settings.showSeconds;
    else if(k==="sendTyping") state.settings.sendTyping=!state.settings.sendTyping;
    else if(k==="showAvatars") state.settings.showAvatars=!state.settings.showAvatars;
    else if(k==="sound") state.settings.sound=!state.settings.sound;
    else if(k==="desktopNotif"){ if(!state.settings.desktopNotif && Notification && Notification.permission!=="granted"){ Notification.requestPermission().then(p=>{ if(p==="granted") state.settings.desktopNotif=true; saveSettings(); applySettings(); }); return; } state.settings.desktopNotif=!state.settings.desktopNotif; }
    else if(k==="notifPreview") state.settings.notifPreview=!state.settings.notifPreview;
    else if(k==="showUnreadBadge") state.settings.showUnreadBadge=!state.settings.showUnreadBadge;
    else if(k==="showOnline") state.settings.showOnline=!state.settings.showOnline;
    else if(k==="sendReadReceipts") state.settings.sendReadReceipts=!state.settings.sendReadReceipts;
    saveSettings(); applySettings();
  }));
  const fr=$("font-range"); if(fr) fr.addEventListener("input",()=>{ const rev=["small","medium","large","xlarge"]; state.settings.fontSize=rev[parseInt(fr.value)||1]||"medium"; saveSettings(); applySettings(); });
  $("settings-nav")?.addEventListener("click", e=>{ const b=e.target.closest(".settings-nav-item"); if(!b) return; openSettingsTab(b.dataset.tab); });
  $("btn-settings")?.addEventListener("click", ()=> openSettings());
  $("btn-close-settings")?.addEventListener("click", closeSettings);
  $("settings-backdrop")?.addEventListener("click", closeSettings);
  document.addEventListener("keydown", e=>{ if(e.key==="Escape"){ if(!$("settings-modal")?.classList.contains("hidden")) closeSettings(); if(!$("create-modal")?.classList.contains("hidden")) closeCreate(); if(!$("members-modal")?.classList.contains("hidden")) closeMembers(); } });
  $("btn-save-name")?.addEventListener("click", saveProfileName);
  $("set-name-input")?.addEventListener("keydown", e=>{ if(e.key==="Enter") saveProfileName(); });
  $("btn-copy-id")?.addEventListener("click", ()=>{ const t=state.me?String(state.me.id):""; if(!t) return; navigator.clipboard?.writeText(t).then(()=>toast("آیدی کپی شد")); });
  $("btn-req-notif")?.addEventListener("click", async()=>{ if(!("Notification" in window)){ alert("مرورگر پشتیبانی نمی‌کند"); return; } const p=await Notification.requestPermission(); if(p==="granted"){ state.settings.desktopNotif=true; saveSettings(); applySettings(); toast("اعلان فعال شد ✅"); } });
  $("btn-revoke-others")?.addEventListener("click", revokeOtherSessions);
  $("btn-export")?.addEventListener("click", exportChats);
  $("btn-clear-all")?.addEventListener("click", ()=>{ if(!confirm("همه داده محلی پاک شود؟")) return; localStorage.clear(); location.reload(); });
  $("btn-reload")?.addEventListener("click", ()=>{ state.ws?.close(); toast("در حال اتصال مجدد…"); setTimeout(()=>connectWs(),400); });
}
function toast(msg){ console.log("[toast]",msg); const el=$("set-name-status")||$("sessions-status")||$("create-status")||$("members-status"); if(el){ el.textContent=msg; setTimeout(()=>{ if(el.textContent===msg) el.textContent=""; },3000); } }
function openSettings(tab){ $("settings-modal")?.classList.remove("hidden"); if(tab) openSettingsTab(tab); refreshSettingsData(); }
function closeSettings(){ $("settings-modal")?.classList.add("hidden"); }
function openSettingsTab(tab){ document.querySelectorAll(".settings-nav-item").forEach(el=>el.classList.toggle("active", el.dataset.tab===tab)); document.querySelectorAll(".settings-tab").forEach(el=>el.classList.toggle("active", el.dataset.tabContent===tab)); }

// ---------------------------------------------------------------------------
// ابزار
// ---------------------------------------------------------------------------
const FA="۰۱۲۳۴۵۶۷۸۹"; const fa=s=>String(s).replace(/\d/g,d=>FA[d]);
const fmtTime=(ts,withSec=false)=>{ const opts=withSec?{hour:"2-digit",minute:"2-digit",second:"2-digit"}:{hour:"2-digit",minute:"2-digit"}; return new Intl.DateTimeFormat("fa-IR",opts).format(ts); };
const fmtDate=ts=>new Intl.DateTimeFormat("fa-IR",{dateStyle:"medium"}).format(ts);
const fmtDateTime=ts=>new Intl.DateTimeFormat("fa-IR",{dateStyle:"short",timeStyle:"medium"}).format(ts);
const sameDay=(a,b)=>new Date(a).toDateString()===new Date(b).toDateString();
const AVATAR_COLORS=["#e17076","#eda86c","#a695e7","#7bc862","#6ec9cb","#65aadd","#ee7aae"];
function setAvatar(el,user){ el.textContent=(user.name||"؟").trim().charAt(0)||"؟"; el.style.background=AVATAR_COLORS[user.id%AVATAR_COLORS.length]; }
async function api(path, opts={}){ const h={"Content-Type":"application/json"}; if(state.token) h.Authorization="Bearer "+state.token; const r=await fetch("/api"+path,{...opts,headers:h}); let d={}; try{ d=await r.json(); }catch{} if(!r.ok){ const e=new Error(d.message||d.error||"خطا"); e.code=d.error; throw e; } return d; }
function lastSeenText(u){ if(!state.settings.showOnline) return ""; if(u.online) return "آنلاین"; if(!u.last_seen) return ""; const now=Date.now(); if(sameDay(u.last_seen,now)) return `آخرین بازدید امروز، ${fmtTime(u.last_seen)}`; if(sameDay(u.last_seen,now-86400000)) return `آخرین بازدید دیروز، ${fmtTime(u.last_seen)}`; return `آخرین بازدید ${fmtDate(u.last_seen)}`; }

// ---------------------------------------------------------------------------
// ورود
// ---------------------------------------------------------------------------
async function showLogin(){
  $("login").classList.remove("hidden"); $("app").classList.add("hidden");
  try{
    const c=await api("/config");
    const botName = c.bot || "@YourBot";
    const els = ["bot-username","bot-username-2","cc-bot-username","about-bot"];
    for(const id of els){
      const el=$(id);
      if(!el) continue;
      if(id==="about-bot") el.textContent=`🤖 بات: ${botName}`;
      else el.textContent=botName;
    }
    // اگر بات وصل نیست، یک راهنما
    if(!c.bot){
      const b=$("bot-username"); if(b) b.textContent="بات هنوز وصل نشده — بعداً دوباره چک کن";
      const b2=$("bot-username-2"); if(b2) b2.textContent="نامشخص";
    }
  }catch(e){
    const b=$("bot-username"); if(b) b.textContent="خطا در گرفتن نام بات — تو تلگرام سرچ کن";
  }
}
function showStep(s){ $("login-step1").classList.toggle("hidden", s!==1); $("login-step2").classList.toggle("hidden", s!==2); }
$("btn-request").addEventListener("click", async()=>{ const tgId=$("tg-id").value.trim(); $("login-error").textContent=""; if(!/^\d+$/.test(tgId)){ $("login-error").textContent="آی‌دی عددی وارد کنید"; return; } $("btn-request").disabled=true; try{ const r=await api("/auth/request",{method:"POST",body:JSON.stringify({tg_id:tgId})}); state.loginToken=r.login_token; $("deep-link").href=r.deep_link; showStep(2); startCountdown(r.expires_in); startPolling(); $("code").focus(); }catch(e){ $("login-error").textContent=e.message; } $("btn-request").disabled=false; });
$("tg-id").addEventListener("keydown", e=>{ if(e.key==="Enter") $("btn-request").click(); });
function startCountdown(sec){ state.countdown=sec; clearInterval(state.countdownTimer); const tick=()=>{ const m=Math.floor(state.countdown/60), s=state.countdown%60; $("countdown").textContent=fa(`${m}:${String(s).padStart(2,"0")}`); if(state.countdown--<=0){ clearInterval(state.countdownTimer); $("verify-error").textContent="کد منقضی شد"; } }; tick(); state.countdownTimer=setInterval(tick,1000); }
function startPolling(){ clearInterval(state.pollTimer); state.pollTimer=setInterval(async()=>{ if(!state.loginToken) return; try{ const r=await api(`/auth/status?login_token=${encodeURIComponent(state.loginToken)}`); if(r.done&&r.token) finishLogin(r.token); else if(r.expired) stopLoginFlow(); }catch{} },2500); }
function stopLoginFlow(){ clearInterval(state.pollTimer); clearInterval(state.countdownTimer); }
$("btn-back").addEventListener("click",()=>{ stopLoginFlow(); state.loginToken=null; $("code").value=""; $("verify-error").textContent=""; showStep(1); });
$("btn-verify").addEventListener("click", async()=>{ const code=$("code").value.trim(); $("verify-error").textContent=""; if(!/^\d{5}$/.test(code)){ $("verify-error").textContent="کد ۵ رقمی"; return; } $("btn-verify").disabled=true; try{ const r=await api("/auth/verify",{method:"POST",body:JSON.stringify({login_token:state.loginToken,code})}); finishLogin(r.token); }catch(e){ $("verify-error").textContent=e.message; } $("btn-verify").disabled=false; });
$("code").addEventListener("keydown", e=>{ if(e.key==="Enter") $("btn-verify").click(); });
function finishLogin(t){ stopLoginFlow(); state.token=t; localStorage.setItem("payam_token",t); enterApp(); }

// ---------------------------------------------------------------------------
// اصلی
// ---------------------------------------------------------------------------
async function enterApp(){
  $("login").classList.add("hidden"); $("app").classList.remove("hidden");
  try{
    const me=await api("/me");
    state.me=me.user;
  }catch(e){
    // فقط اگر واقعاً توکن بی‌اعتبار باشه لاگ‌اوت کن، نه وقتی آفلاین یا سرور خوابه
    if(e.code==="unauthorized" || e.message.includes("401")){
      localStorage.removeItem("payam_token");
      state.token=null;
      showLogin();
    }else{
      // نت قطعه یا سرور خوابه — با همون توکن بمون و دوباره تلاش کن
      console.warn("enterApp /me failed, keeping token", e);
      // سعی کن با کش محلی ادامه بدی یا بعداً رفرش کنی
      setTimeout(()=>{ if(state.token) enterApp(); }, 3000);
      toast("اتصال به سرور برقرار نیست — تلاش مجدد...");
    }
    return;
  }
  $("me-name").textContent=state.me.name; $("me-username").textContent=state.me.username?"@"+state.me.username:""; setAvatar($("me-avatar"),state.me);
  try{ const r=await api("/users"); state.users.clear(); for(const u of r.users) state.users.set(u.id,u); }catch{}
  try{ const r=await api("/groups"); state.groups.clear(); for(const g of r.groups) state.groups.set(g.id,g); }catch{}
  try{ const r=await api("/contacts"); state.contacts.clear(); for(const c of r.contacts) state.contacts.set(c.id,c); }catch{}
  try{
    const conv=await api("/conversations");
    state.lastMsg.clear(); state.lastGroupMsg.clear();
    for(const [k,v] of Object.entries(conv.last)){
      const id=Number(k);
      if(!v) continue;
      if(id<0){ // گروه قدیمی منفی
        const gid=-id; state.lastGroupMsg.set(gid,{text:v.text, ts:v.ts, from:v.sender, out:v.sender===state.me.id});
      }else{
        // تشخیص گروه یا شخصی از طریق فیلد group
        if(v.group_id){ state.lastGroupMsg.set(v.group_id,{text:v.text, ts:v.ts, from:v.sender, out:v.sender===state.me.id}); }
        else state.lastMsg.set(id,{text:v.text, ts:v.ts, out:v.sender===state.me.id});
      }
    }
    // اگر بک‌اند جدید last را با کلید g_ می‌دهد، ساپورت کنیم
    if(conv.last.groups){
      for(const [gid, m] of Object.entries(conv.last.groups)){
        if(!m) continue;
      }
    }
  }catch(e){ console.warn("conv fail",e); }
  renderSidebar();
  connectWs();
  refreshSettingsData();
  startMessagePolling();
}
function startMessagePolling(){
  // فال‌بک ابری — هر 4 ثانیه چک کن آیا پیام جدیدی اومده (اگر وب‌سوکت قطع باشه یا پیام جا بیفته)
  setInterval(async()=>{
    try{
      // اگه تب مخفیه یا کاربر لاگین نیست، نکن
      if(!state.me || !state.token) return;
      // فقط اگر وب‌سوکت قطع باشه یا 5 ثانیه آخر پیامی نیومده، پول کن — ولی برای سادگی همیشه چک می‌کنیم چون سبک هست
      const conv=await api("/conversations");
      let needRender=false;
      // آپدیت lastMsg های شخصی
      for(const [k,v] of Object.entries(conv.last)){
        const id=Number(k);
        if(!v) continue;
        if(v.group_id){
          const existing=state.lastGroupMsg.get(v.group_id);
          if(!existing || v.ts>existing.ts){
            state.lastGroupMsg.set(v.group_id,{text:v.text, ts:v.ts, from:v.sender, out:v.sender===state.me.id});
            needRender=true;
            // اگه همین گروه بازه و پیامش جدیدتر از آخرین پیام ماست، تاریخچه رو رفرش کن
            if(state.group===v.group_id && (!state.msgs.length || v.ts>state.msgs[state.msgs.length-1].ts)){
              try{
                const r=await api(`/groups/${v.group_id}/messages`);
                // فقط پیام‌هایی که نداریم اضافه کن
                for(const nm of r.messages){
                  if(!state.msgs.some(m=>m.id===nm.id)){
                    state.msgs.push(nm);
                    appendBubble(nm);
                  }
                }
                scrollDown();
              }catch{}
            }
          }
        } else if(id>0){
          const existing=state.lastMsg.get(id);
          if(!existing || v.ts>existing.ts){
            state.lastMsg.set(id,{text:v.text, ts:v.ts, out:v.sender===state.me.id});
            needRender=true;
            if(state.peer===id && (!state.msgs.length || v.ts>state.msgs[state.msgs.length-1].ts)){
              try{
                const r=await api(`/messages?with=${id}`);
                for(const nm of r.messages){
                  if(!state.msgs.some(m=>m.id===nm.id)){
                    state.msgs.push(nm);
                    appendBubble(nm);
                  }
                }
                scrollDown();
              }catch{}
            }
          }
        } else if(id<0){
          const gid=-id;
          const existing=state.lastGroupMsg.get(gid);
          if(!existing || v.ts>existing.ts){
            state.lastGroupMsg.set(gid,{text:v.text, ts:v.ts, from:v.sender, out:v.sender===state.me.id});
            needRender=true;
          }
        }
      }
      if(needRender) renderSidebar();
    }catch(e){ /* ignore */ }
  }, 4000);
}
function setConn(on){ const el=$("conn-state"); el.classList.toggle("on", on===true); el.classList.toggle("off", on===false); }
function connectWs(){
  const proto=location.protocol==="https:"?"wss":"ws";
  const ws=new WebSocket(`${proto}://${location.host}/ws?token=${encodeURIComponent(state.token)}`);
  state.ws=ws;
  ws.onopen=()=>{ state.wsRetry=0; setConn(true); };
  ws.onmessage=ev=>{ let m; try{ m=JSON.parse(ev.data); }catch{ return; } handleEvent(m); };
  ws.onclose=()=>{ setConn(false); const d=Math.min(10000,1000*2**state.wsRetry++); setTimeout(connectWs,d); };
}
function wsSend(o){ if(state.ws && state.ws.readyState===WebSocket.OPEN) state.ws.send(JSON.stringify(o)); }

function handleEvent(msg){
  switch(msg.t){
    case "hello":{
      for(const u of msg.users) state.users.set(u.id,u);
      if(msg.groups){ state.groups.clear(); for(const g of msg.groups) state.groups.set(g.id,g); }
      state.unread.clear(); for(const [p,c] of Object.entries(msg.unread||{})) state.unread.set(Number(p),c);
      state.unreadGroups.clear(); for(const [p,c] of Object.entries(msg.unreadGroups||{})) state.unreadGroups.set(Number(p),c);
      if(msg.last){ for(const [k,v] of Object.entries(msg.last)){ const id=Number(k); if(!v) continue; if(v.group_id){ state.lastGroupMsg.set(v.group_id,{text:v.text,ts:v.ts,from:v.sender,out:v.sender===state.me.id}); } else if(id<0){ state.lastGroupMsg.set(-id,{text:v.text,ts:v.ts,from:v.sender,out:v.sender===state.me.id}); } else state.lastMsg.set(id,{text:v.text,ts:v.ts,out:v.sender===state.me.id}); } }
      renderSidebar(); if(state.peer||state.group) renderPeerStatus(); updateTitleBadge(); break;
    }
    case "user":{ state.users.set(msg.user.id,msg.user); renderSidebar(); break; }
    case "group":{
      // گروه جدید یا آپدیت
      if(msg.group) state.groups.set(msg.group.id, msg.group);
      renderSidebar(); break;
    }
    case "presence":{ const u=state.users.get(msg.id); if(u){ u.online=msg.online; if(msg.last_seen) u.last_seen=msg.last_seen; renderSidebar(); if(state.peer===msg.id) renderPeerStatus(); } break; }
    case "msg":{
      if(msg.ack){ onAck(msg); }
      else{
        if(msg.group){
          const gid=Number(msg.group);
          if(state.msgs.some(m=>m.id===msg.id)) break;
          state.lastGroupMsg.set(gid,{text:msg.text, ts:msg.ts, from:msg.from, out:false});
          if(state.group===gid){
            const sender=state.users.get(msg.from);
            const row={ id:msg.id, sender:msg.from, recipient: state.me.id, text:msg.text, ts:msg.ts, group_id:gid, read_at:null, senderName: sender?sender.name:`کاربر ${msg.from}` };
            state.msgs.push(row); appendBubble(row); scrollDown();
          }else{
            state.unreadGroups.set(gid,(state.unreadGroups.get(gid)||0)+1);
            playSound(); notifyDesktop({...msg, text:`[گروه] ${msg.text}`});
          }
          renderSidebar(); updateTitleBadge();
        }else{
          const isSelfCloud=msg.from===state.me.id && msg.to===state.me.id;
          const isFromOther=msg.from!==state.me.id;
          if(isFromOther||isSelfCloud){
            if(state.msgs.some(m=>m.id===msg.id)) break;
            const peerId=isSelfCloud?msg.to:msg.from;
            state.lastMsg.set(peerId,{text:msg.text, ts:msg.ts, out:isSelfCloud});
            const isOpen=(state.peer===peerId)||(isSelfCloud&&isSavedId(state.peer));
            if(isOpen){
              state.msgs.push({id:msg.id,sender:msg.from,recipient:msg.to,text:msg.text,ts:msg.ts,group_id:null,read_at:msg.read?Date.now():null});
              appendBubble(state.msgs[state.msgs.length-1]); scrollDown();
              if(isFromOther && state.settings.sendReadReceipts) wsSend({t:"read",peer:msg.from});
            }else if(isFromOther){
              state.unread.set(msg.from,(state.unread.get(msg.from)||0)+1);
              playSound(); notifyDesktop(msg);
            }
            renderSidebar(); updateTitleBadge();
          }
        }
      }
      break;
    }
    case "typing":{ if(msg.group){ if(state.group===msg.group) showTyping(); } else if(state.peer===msg.from) showTyping(); break; }
    case "read":{ for(const m of state.msgs){ if(m.sender===state.me.id && m.recipient===msg.by) m.read_at=Date.now(); } if(state.peer===msg.by) renderMessages(); break; }
    case "pong": break;
  }
}

let audioCtx=null;
function playSound(){ if(!state.settings.sound) return; try{ if(!audioCtx) audioCtx=new (window.AudioContext||window.webkitAudioContext)(); const o=audioCtx.createOscillator(); const g=audioCtx.createGain(); o.type="sine"; o.frequency.value=880; g.gain.value=0.06; o.connect(g); g.connect(audioCtx.destination); o.start(); g.gain.exponentialRampToValueAtTime(0.0001,audioCtx.currentTime+0.35); setTimeout(()=>{ try{o.stop()}catch{} },350); }catch{} }
function notifyDesktop(msg){ if(!state.settings.desktopNotif) return; if(!("Notification" in window)||Notification.permission!=="granted") return; if(document.visibilityState==="visible" && (state.peer===msg.from || state.group===msg.group)) return; const fromUser=state.users.get(msg.from); const title=msg.group? `گروه: ${(state.groups.get(msg.group)?.name||"گروه")}` : (fromUser?fromUser.name:"پیام جدید"); const body=state.settings.notifPreview?msg.text.slice(0,120):"پیام جدید"; try{ new Notification(title,{body}); }catch{} }
function updateTitleBadge(){ if(!state.settings.showUnreadBadge){ document.title="Furina mind"; return; } let total=0; for(const v of state.unread.values()) total+=v; for(const v of state.unreadGroups.values()) total+=v; document.title= total>0? `(${fa(total)}) Furina mind` : "Furina mind"; }

// ---------------------------------------------------------------------------
// سایدبار تب‌ها
// ---------------------------------------------------------------------------
function setActiveTab(tab){
  state.activeTab=tab;
  document.querySelectorAll(".sidebar-tab").forEach(el=> el.classList.toggle("active", el.dataset.tab===tab));
  const all=$("all-list"); if(all) all.classList.toggle("hidden", tab!=="all");
  $("user-list").classList.toggle("hidden", tab!=="chats");
  $("group-list").classList.toggle("hidden", tab!=="groups");
  $("channel-list").classList.toggle("hidden", tab!=="channels");
  $("contact-list").classList.toggle("hidden", tab!=="contacts");
  renderSidebar();
}
document.querySelectorAll(".sidebar-tab").forEach(el=> el.addEventListener("click", ()=> setActiveTab(el.dataset.tab)));
$("btn-new")?.addEventListener("click", ()=> openCreateModal(state.activeTab==="contacts"?"contact": state.activeTab==="channels"?"channel":"group"));
$("empty-contacts-hint")?.addEventListener("click", ()=> openCreateModal("contact"));

function buildConvItem(u, opts={}){
  const saved=!!opts.saved;
  const item=document.createElement("div"); item.className="user-item"+(state.peer===u.id?" active":""); item.addEventListener("click",()=>openPrivate(u.id));
  const avatar=document.createElement("div"); avatar.className="avatar";
  if(saved){ avatar.textContent="🔖"; avatar.style.background="linear-gradient(135deg, #2b5278, #64b5ef)"; }
  else{ setAvatar(avatar,u); if(u.online&&state.settings.showOnline){ const d=document.createElement("span"); d.className="online-dot"; avatar.appendChild(d); } }
  const meta=document.createElement("div"); meta.className="user-meta";
  const last=state.lastMsg.get(u.id);
  const top=document.createElement("div"); top.className="user-top";
  const name=document.createElement("div"); name.className="user-name"; name.textContent=saved?SAVED_NAME:u.name||`کاربر ${u.id}`;
  const time=document.createElement("div"); time.className="user-time"; time.textContent=last?fmtTime(last.ts,state.settings.showSeconds):"";
  top.append(name,time);
  const bottom=document.createElement("div"); bottom.className="user-bottom";
  const preview=document.createElement("div"); preview.className="user-preview"; preview.textContent= last? (last.out?"شما: ":"")+last.text : saved?"یادداشت‌های ذخیره‌شده‌ی شما": lastSeenText(u);
  bottom.appendChild(preview);
  const unread=saved?0:state.unread.get(u.id)||0;
  if(unread>0){ const b=document.createElement("div"); b.className="badge"; b.textContent=fa(unread); bottom.appendChild(b); }
  meta.append(top,bottom); item.append(avatar,meta); return item;
}

function buildGroupItem(g){
  const item=document.createElement("div"); item.className="group-item"+(state.group===g.id?" active":"");
  item.addEventListener("click",()=>openGroup(g.id));
  const avatar=document.createElement("div"); avatar.className="group-avatar "+(g.type==="channel"?"channel":"group"); avatar.textContent=g.type==="channel"?"📢": g.name.trim().charAt(0)||"G";
  const meta=document.createElement("div"); meta.className="group-meta";
  const last=state.lastGroupMsg.get(g.id);
  const top=document.createElement("div"); top.className="user-top";
  const name=document.createElement("div"); name.className="group-name"; name.textContent=g.name;
  const time=document.createElement("div"); time.className="user-time"; time.textContent=last?fmtTime(last.ts,state.settings.showSeconds):"";
  top.append(name,time);
  const bottom=document.createElement("div"); bottom.className="user-bottom";
  const preview=document.createElement("div"); preview.className="group-sub"; preview.textContent= last? `${state.users.get(last.from)?.name||"کاربر"}: ${last.text}` : `${g.member_count||0} عضو — ${g.type==="channel"?"کانال":"گروه"}`;
  bottom.appendChild(preview);
  const unread=state.unreadGroups.get(g.id)||0;
  if(unread>0){ const b=document.createElement("div"); b.className="badge"; b.textContent=fa(unread); bottom.appendChild(b); }
  meta.append(top,bottom); item.append(avatar,meta); return item;
}

function buildContactItem(c){
  const item=document.createElement("div"); item.className="contact-item";
  const user=c.user || (c.contact_user_id? state.users.get(c.contact_user_id): null);
  const avatar=document.createElement("div"); avatar.className="group-avatar contact"; avatar.textContent=c.name.trim().charAt(0)||"C";
  if(user) setAvatar(avatar,user);
  const meta=document.createElement("div"); meta.className="group-meta";
  const top=document.createElement("div"); top.className="user-top";
  const name=document.createElement("div"); name.className="group-name"; name.textContent=c.alias?`${c.alias} (${c.name})`:c.name;
  const sub=document.createElement("div"); sub.className="user-time"; sub.textContent=c.contact_user_id? "عضو ✅" : "دعوت نشده";
  top.append(name,sub);
  const bottom=document.createElement("div"); bottom.className="user-bottom";
  const preview=document.createElement("div"); preview.className="group-sub"; preview.textContent= user? (user.username?`@${user.username}`:`ID ${user.id}`) : (c.phone?c.phone:"—");
  bottom.appendChild(preview);
  const actions=document.createElement("div"); actions.style.display="flex"; actions.style.gap="6px";
  if(user){
    const btn=document.createElement("button"); btn.className="btn btn-ghost"; btn.style.padding="4px 8px"; btn.textContent="چت"; btn.addEventListener("click", e=>{ e.stopPropagation(); openPrivate(user.id); });
    actions.appendChild(btn);
  }
  const del=document.createElement("button"); del.className="icon-btn"; del.textContent="🗑️"; del.title="حذف مخاطب"; del.addEventListener("click", async e=>{ e.stopPropagation(); if(!confirm(`حذف ${c.name}؟`)) return; try{ await api(`/contacts/${c.id}`,{method:"DELETE"}); state.contacts.delete(c.id); renderSidebar(); toast("حذف شد"); }catch(err){ toast("خطا: "+err.message); } });
  actions.appendChild(del);
  bottom.appendChild(actions);
  meta.append(top,bottom); item.append(avatar,meta);
  item.addEventListener("click", ()=>{ if(user) openPrivate(user.id); });
  return item;
}

function renderSidebar(){
  const q=$("search").value.trim().toLowerCase();
  // چت‌ها
  const ul=$("user-list"); if(ul){ ul.innerHTML=""; const savedMatches= state.me && (!q || SAVED_NAME.includes(q) || "saved".includes(q)); const users=[...state.users.values()].filter(u=> !q || u.name.toLowerCase().includes(q) || (u.username||"").toLowerCase().includes(q)).sort((a,b)=>{ const ta=state.lastMsg.get(a.id)?.ts||0, tb=state.lastMsg.get(b.id)?.ts||0; return tb-ta; }); if(savedMatches) ul.appendChild(buildConvItem({id:state.me.id}, {saved:true})); for(const u of users) ul.appendChild(buildConvItem(u)); if(!savedMatches && users.length===0 && state.activeTab==="chats"){ const d=document.createElement("div"); d.className="dim"; d.style.cssText="text-align:center;padding:24px 12px;line-height:2"; d.textContent=q?"نتیجه‌ای نیست":"هنوز کسی نیست — دوستات رو دعوت کن!"; ul.appendChild(d); } }

  // گروه‌ها
  const gl=$("group-list"); if(gl){ gl.innerHTML=""; const groups=[...state.groups.values()].filter(g=>g.type==="group" && (!q || g.name.toLowerCase().includes(q))).sort((a,b)=>{ const ta=state.lastGroupMsg.get(a.id)?.ts||0, tb=state.lastGroupMsg.get(b.id)?.ts||0; return tb-ta; }); if(groups.length===0){ const d=document.createElement("div"); d.className="empty-contacts"; d.innerHTML= q? "گروهی پیدا نشد" : "<b>گروهی نداری</b><br>دکمه + بزن و گروه بساز"; gl.appendChild(d); } else for(const g of groups) gl.appendChild(buildGroupItem(g)); }

  // کانال‌ها
  const cl=$("channel-list"); if(cl){ cl.innerHTML=""; const channels=[...state.groups.values()].filter(g=>g.type==="channel" && (!q || g.name.toLowerCase().includes(q))).sort((a,b)=> (state.lastGroupMsg.get(b.id)?.ts||0)-(state.lastGroupMsg.get(a.id)?.ts||0)); if(channels.length===0){ const d=document.createElement("div"); d.className="empty-contacts"; d.innerHTML= q? "کانالی نیست" : "<b>کانالی نداری</b><br>با + کانال بساز"; cl.appendChild(d); } else for(const g of channels) cl.appendChild(buildGroupItem(g)); }

  // مخاطبین
  const cot=$("contact-list"); if(cot){ cot.innerHTML=""; const contacts=[...state.contacts.values()].filter(c=> !q || c.name.toLowerCase().includes(q) || (c.phone||"").includes(q)).sort((a,b)=> a.name.localeCompare(b.name)); if(contacts.length===0){ const d=document.createElement("div"); d.className="empty-contacts"; d.innerHTML= `<b>مخاطبی نداری</b><br>از بات تلگرام ایمپورت کن<br><span class="link-chip" style="margin-top:8px;display:inline-flex">برو تو بات و دکمه 📇 اشتراک مخاطب رو بزن</span>`; cot.appendChild(d); } else for(const c of contacts) cot.appendChild(buildContactItem(c)); }

  // همه — ترکیب همه چیز بر اساس آخرین پیام
  const al=$("all-list"); if(al){
    al.innerHTML="";
    const items=[];
    // ذخیره‌شده‌ها
    if(state.me && (!q || SAVED_NAME.includes(q))){
      const last=state.lastMsg.get(state.me.id);
      items.push({type:"saved", id:state.me.id, ts:last?.ts||0, last});
    }
    // چت‌های شخصی
    for(const u of [...state.users.values()].filter(u=> !q || u.name.toLowerCase().includes(q) || (u.username||"").toLowerCase().includes(q))){
      const last=state.lastMsg.get(u.id);
      items.push({type:"private", user:u, id:u.id, ts:last?.ts||0, last});
    }
    // گروه و کانال
    for(const g of [...state.groups.values()].filter(g=> !q || g.name.toLowerCase().includes(q))){
      const last=state.lastGroupMsg.get(g.id);
      items.push({type:g.type==="channel"?"channel":"group", group:g, id:g.id, ts:last?.ts||0, last});
    }
    // مرتب بر اساس زمان
    items.sort((a,b)=> b.ts - a.ts);
    // اگه هیچی نیست و سرچ نیست، مخاطبین رو هم نشون بده که دعوت کنه
    if(items.length===0){
      const d=document.createElement("div"); d.className="empty-contacts"; d.innerHTML= q? "چیزی پیدا نشد" : "<b>هنوز چیزی نداری</b><br>گروه بساز یا از بات مخاطب ایمپورت کن";
      al.appendChild(d);
    }else{
      // نمایش حداکثر 100 تای اخیر
      for(const it of items.slice(0,100)){
        if(it.type==="saved") al.appendChild(buildConvItem({id:state.me.id}, {saved:true}));
        else if(it.type==="private") al.appendChild(buildConvItem(it.user));
        else al.appendChild(buildGroupItem(it.group));
      }
      // اگه سرچ خالیه و مخاطب هم داریم، بخش مخاطبین سریع هم اضافه کن
      if(!q && state.contacts.size>0 && items.length<20){
        const sep=document.createElement("div"); sep.className="day-sep"; sep.textContent="مخاطبین پیشنهادی"; al.appendChild(sep);
        for(const c of [...state.contacts.values()].slice(0,5)) al.appendChild(buildContactItem(c));
      }
    }
  }
}
$("search").addEventListener("input", renderSidebar);

// ---------------------------------------------------------------------------
// چت شخصی / گروهی
// ---------------------------------------------------------------------------
function resetChatView(){
  $("empty-state").classList.add("hidden");
  $("chat-view").classList.remove("hidden");
  $("app").classList.add("chat-open");
  $("messages").innerHTML=""; state.msgs=[]; state.pending.clear();
}

async function openPrivate(peerId){
  const saved=isSavedId(peerId);
  const peer=saved?state.me: state.users.get(peerId);
  if(!peer) return;
  state.peer=peerId; state.group=null;
  resetChatView();
  $("peer-name").textContent= saved?SAVED_NAME: peer.name||`کاربر ${peer.id}`;
  const avatarEl=$("peer-avatar");
  if(saved){ avatarEl.textContent="🔖"; avatarEl.style.background="linear-gradient(135deg, #2b5278, #64b5ef)"; }
  else{ avatarEl.style.background=""; setAvatar(avatarEl,peer); }
  renderPeerStatus();
  $("btn-group-invite").classList.add("hidden"); $("btn-group-members").classList.add("hidden");
  $("composer").classList.remove("hidden"); $("readonly-bar").classList.add("hidden");
  try{ const r=await api(`/messages?with=${peerId}`); state.msgs=r.messages; if(r.messages.length>0) state.lastMsg.set(peerId,{text:r.messages[r.messages.length-1].text, ts:r.messages[r.messages.length-1].ts, out:r.messages[r.messages.length-1].sender===state.me.id}); }catch{}
  renderMessages(); renderSidebar(); scrollDown(true); updateTitleBadge(); $("input").focus();
}

async function openGroup(groupId){
  const g=state.groups.get(groupId);
  if(!g) return;
  state.group=groupId; state.peer=null;
  resetChatView();
  $("peer-name").textContent=g.name;
  const avatarEl=$("peer-avatar"); avatarEl.className="avatar"; avatarEl.textContent=g.type==="channel"?"📢":"👥"; avatarEl.style.background= g.type==="channel"?"linear-gradient(135deg,#ff8a4b,#ffbd4b)":"linear-gradient(135deg,#6a5af9,#8a7cf9)";
  $("peer-status").textContent= `${g.type==="channel"?"کانال":"گروه"} • ${g.member_count||"?"} عضو • ${g.description||""}`;
  $("btn-group-invite").classList.remove("hidden"); $("btn-group-members").classList.remove("hidden");
  // کانال فقط ادمین
  if(g.type==="channel"){
    try{
      const info=await api(`/groups/${groupId}`); const myRole=info.members.find(m=>m.user.id===state.me.id)?.role;
      const canPost=myRole==="owner"||myRole==="admin";
      $("composer").classList.toggle("hidden", !canPost); $("readonly-bar").classList.toggle("hidden", canPost);
    }catch{ $("composer").classList.remove("hidden"); }
  }else{ $("composer").classList.remove("hidden"); $("readonly-bar").classList.add("hidden"); }
  state.unreadGroups.set(groupId,0);
  try{ const r=await api(`/groups/${groupId}/messages`); state.msgs=r.messages; if(r.messages.length>0){ const last=r.messages[r.messages.length-1]; state.lastGroupMsg.set(groupId,{text:last.text, ts:last.ts, from:last.sender, out:last.sender===state.me.id}); renderSidebar(); } }catch{}
  renderMessages(); updateTitleBadge(); $("input").focus();
}

$("btn-back-chat").addEventListener("click", ()=>{ state.peer=null; state.group=null; $("app").classList.remove("chat-open"); $("chat-view").classList.add("hidden"); $("empty-state").classList.remove("hidden"); renderSidebar(); });
function renderPeerStatus(){
  const el=$("peer-status");
  if(state.group){ return; }
  if(isSavedId(state.peer)){ el.textContent="☁️ یادداشت‌های شخصی شما"; return; }
  const u=state.users.get(state.peer); if(!u) return;
  if(Date.now()<state.typingUntil){ el.textContent="در حال نوشتن…"; el.style.color="var(--accent)"; } else{ el.textContent=lastSeenText(u); el.style.color=u.online?"var(--accent)":""; }
}
function showTyping(){ state.typingUntil=Date.now()+3000; renderPeerStatus(); clearTimeout(state.typingTimer); state.typingTimer=setTimeout(renderPeerStatus,3100); }

function renderMessages(){
  const box=$("messages"); box.innerHTML=""; let lastDay=null;
  for(const m of state.msgs){
    if(!lastDay || !sameDay(m.ts,lastDay)){ const sep=document.createElement("div"); sep.className="day-sep"; sep.textContent=sameDay(m.ts,Date.now())?"امروز":fmtDate(m.ts); box.appendChild(sep); lastDay=m.ts; }
    box.appendChild(buildBubble(m));
  }
}
function buildBubble(m){
  const out=m.sender===state.me.id;
  const isGroup=!!m.group_id || !!m.group;
  const isPending=m.id===-1;
  const el=document.createElement("div"); el.className=`bubble ${out?"out":"in"}`+(isSavedId(m.recipient)&&out?" saved-self":"")+(isPending?" pending":"")+(m.msg_type&&m.msg_type!=="text"?" has-file":"");
  if(isGroup && !out){
    const senderName=document.createElement("span"); senderName.className="sender-name";
    const user=state.users.get(m.sender); senderName.textContent=user?user.name:`کاربر ${m.sender}`;
    el.appendChild(senderName);
  }

  // فایل / عکس / ویدیو / گیف
  if(m.file_url){
    const type=m.msg_type||"file";
    if(type==="image"||type==="gif"){
      const img=document.createElement("img");
      img.src=m.file_url; img.alt=m.file_name||"image"; img.style.maxWidth="260px"; img.style.maxHeight="320px"; img.style.borderRadius="12px"; img.style.display="block"; img.style.marginBottom="6px"; img.style.cursor="pointer";
      img.addEventListener("click",()=> window.open(m.file_url,"_blank"));
      el.appendChild(img);
    }else if(type==="video"){
      const vid=document.createElement("video");
      vid.src=m.file_url; vid.controls=true; vid.style.maxWidth="260px"; vid.style.borderRadius="12px"; vid.style.display="block"; vid.style.marginBottom="6px";
      el.appendChild(vid);
    }else{
      const fileBox=document.createElement("div");
      fileBox.style.display="flex"; fileBox.style.alignItems="center"; fileBox.style.gap="8px"; fileBox.style.background="rgba(0,0,0,0.12)"; fileBox.style.padding="8px 10px"; fileBox.style.borderRadius="10px"; fileBox.style.marginBottom="6px";
      const icon=document.createElement("div"); icon.textContent= type==="voice"?"🎙️": type==="file"?"📄":"📎"; icon.style.fontSize="1.4rem";
      const info=document.createElement("div"); info.style.flex="1"; info.style.minWidth="0";
      const name=document.createElement("div"); name.textContent=m.file_name||"فایل"; name.style.fontWeight="700"; name.style.fontSize="0.85rem"; name.style.whiteSpace="nowrap"; name.style.overflow="hidden"; name.style.textOverflow="ellipsis";
      const size=document.createElement("div"); size.textContent= m.file_size? `${(m.file_size/1024).toFixed(1)} KB • ${m.mime||""}` : (m.mime||""); size.className="dim"; size.style.fontSize="0.72rem";
      info.append(name,size);
      const dl=document.createElement("a"); dl.href=m.file_url; dl.download=m.file_name||""; dl.textContent="⬇️"; dl.style.fontSize="1.2rem"; dl.style.textDecoration="none";
      fileBox.append(icon,info,dl);
      el.appendChild(fileBox);
    }
  }

  if(m.text && !(m.file_url && !m.text.trim() || m.text===m.file_name)){
    const text=document.createElement("span"); text.textContent=m.text; el.appendChild(text);
  }else if(!m.file_url){
    const text=document.createElement("span"); text.textContent=m.text||""; el.appendChild(text);
  }

  // ریپلای
  if(m.reply_to){
    const rep=state.msgs.find(x=>x.id===m.reply_to);
    if(rep){
      const rbox=document.createElement("div"); rbox.style.borderRight="3px solid var(--accent)"; rbox.style.paddingRight="8px"; rbox.style.marginBottom="6px"; rbox.style.opacity="0.8"; rbox.style.fontSize="0.8rem";
      rbox.innerHTML=`<div style="font-weight:700; color:var(--accent)">${state.users.get(rep.sender)?.name||"—"}</div><div style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis">${rep.text.slice(0,80)}</div>`;
      el.prepend(rbox);
    }
  }

  const meta=document.createElement("span"); meta.className="meta";
  const time=document.createElement("span"); time.textContent=fmtTime(m.ts,state.settings.showSeconds); meta.appendChild(time);
  if(out){
    const ticks=document.createElement("span"); ticks.className="ticks"+(m.read_at && !isPending?" read":"")+(isPending?" pending-spin":"");
    ticks.textContent=isPending?"⏳":(m.read_at?"✓✓":"✓");
    ticks.title=isPending?"در حال ارسال...":"ارسال شد";
    meta.appendChild(ticks);
  }
  el.appendChild(meta);
  // کلیک راست — ریپلای
  el.addEventListener("contextmenu", e=>{ e.preventDefault(); setReply(m); });
  // دوبار کلیک برای پروفایل
  el.addEventListener("dblclick", ()=>{ if(!out) openProfile(m.sender); });
  return el;
}

let replyToId=null;
function setReply(m){
  replyToId=m.id;
  const box=$("reply-preview"); if(!box) return;
  box.classList.remove("hidden");
  const user=state.users.get(m.sender);
  $("reply-name").textContent=user?user.name:`کاربر ${m.sender}`;
  $("reply-text").textContent=m.text.slice(0,100);
  $("input").focus();
}
function clearReply(){ replyToId=null; $("reply-preview")?.classList.add("hidden"); }
$("btn-cancel-reply")?.addEventListener("click", clearReply);
function appendBubble(m){ $("messages").appendChild(buildBubble(m)); }
function scrollDown(force){ if(!force && !state.settings.autoScroll) return; const box=$("messages"); requestAnimationFrame(()=>{ box.scrollTop=box.scrollHeight; }); }
function onAck(msg){
  const el=msg.temp? state.pending.get(msg.temp): null;
  if(el){
    state.pending.delete(msg.temp);
    const idx=state.msgs.findIndex(x=>x.id===-1 && (x.text===msg.text || msg.file) && (x.recipient===msg.to || x.group_id===msg.group));
    const m={ id:msg.id, sender:state.me.id, recipient:msg.to||state.me.id, text:msg.text, ts:msg.ts, group_id:msg.group||null, read_at: isSavedId(msg.to)||msg.group?Date.now():null,
      msg_type:msg.file?.type||msg.msg_type||"text", file_url:msg.file?.url||msg.file_url||null, file_name:msg.file?.name||msg.file_name||null, file_size:msg.file?.size||msg.file_size||null, mime:msg.file?.mime||msg.mime||null, reply_to:msg.reply_to||null };
    if(idx!==-1) state.msgs[idx]=m; else state.msgs.push(m);
    const fresh=buildBubble(m); el.replaceWith(fresh);
  }else{
    if(state.msgs.some(x=>x.id===msg.id)) return;
    if(msg.group && state.group===msg.group){
      const mm={ id:msg.id, sender:state.me.id, text:msg.text, ts:msg.ts, group_id:msg.group, msg_type:msg.file?.type||msg.msg_type, file_url:msg.file?.url||msg.file_url, file_name:msg.file?.name||msg.file_name }; state.msgs.push(mm); appendBubble(mm); scrollDown();
    }else if(msg.to===state.peer || (msg.group&&state.group===msg.group) || state.msgs.some(x=>x.recipient===msg.to)){
      const mm={ id:msg.id, sender:state.me.id, recipient:msg.to, text:msg.text, ts:msg.ts, group_id:msg.group||null, msg_type:msg.file?.type||msg.msg_type, file_url:msg.file?.url||msg.file_url, file_name:msg.file?.name||msg.file_name }; state.msgs.push(mm); if(msg.to===state.peer||msg.group===state.group){ appendBubble(mm); scrollDown(); }
    }
  }
  if(msg.group) state.lastGroupMsg.set(msg.group,{text:msg.file?`[${msg.file.type}] ${msg.text}`:msg.text, ts:msg.ts, from:state.me.id, out:true});
  else state.lastMsg.set(msg.to,{text:msg.file?`[${msg.file?.type||msg.msg_type}] ${msg.text}`:msg.text, ts:msg.ts, out:true});
  renderSidebar();
  clearReply();
}
async function sendMessage(){
  const input=$("input"); const text=input.value.trim();
  if((!text||!text.length) && !replyToId && (!state.peer&&!state.group)) return;
  // اگه فقط ریپلای بدون متن نباشه هم بفرست
  if(!text && !replyToId && !state.peer && !state.group) return;
  if(!text && !replyToId) {
    // اجازه بده فقط فایل قبلاً آپلود شده باشه، ولی اینجا متن خالیه — نادیده
    if(!state.peer && !state.group) return;
  }
  input.value=""; input.style.height="auto";
  const temp="t"+Date.now()+Math.random().toString(36).slice(2,7);
  const optimistic={ id:-1, sender:state.me.id, recipient:state.peer||state.me.id, text:text||"", ts:Date.now(), group_id:state.group||null, read_at:null, reply_to:replyToId };
  state.msgs.push(optimistic);
  const el=buildBubble(optimistic); el.classList.add("pending"); $("messages").appendChild(el); state.pending.set(temp,el);
  scrollDown(true);
  if(state.group) state.lastGroupMsg.set(state.group,{text:text||"پیام", ts:optimistic.ts, from:state.me.id, out:true});
  else state.lastMsg.set(state.peer,{text:text||"پیام", ts:optimistic.ts, out:true});
  renderSidebar();
  const payload={ text, temp, reply_to:replyToId };
  if(state.group) payload.group=state.group; else payload.to=state.peer;
  const rt=replyToId; clearReply();
  let acked=false;
  wsSend({ t:"msg", to:payload.to, group:payload.group, text:payload.text, temp, reply_to:rt });
  setTimeout(()=>{
    if(state.pending.has(temp) && !acked){
      const p2= state.group? {group:state.group, text:payload.text, reply_to:rt} : {to:state.peer, text:payload.text, reply_to:rt};
      api("/messages",{method:"POST", body:JSON.stringify(p2)}).then(r=>{
        if(!state.pending.has(temp)) return;
        onAck({id:r.message.id, to:state.peer, group:state.group, text:r.message.text, ts:r.message.ts, temp, reply_to:rt}); acked=true;
      }).catch(()=>{ const p=state.pending.get(temp); if(p){ p.style.border="1px solid #e56555"; p.title="ناموفق"; } });
    }
  },2500);
}
$("btn-send").addEventListener("click", sendMessage);
$("btn-chat-info")?.addEventListener("click", ()=>{ if(state.group) openMembersModal(state.group); else openSettings("profile"); });
$("btn-group-invite")?.addEventListener("click", async()=>{ if(!state.group) return; try{ const r=await api(`/groups/${state.group}/invite`,{method:"POST"}); const link=r.link; await navigator.clipboard.writeText(link); toast("لینک دعوت کپی شد: "+link); }catch(e){ toast("خطا: "+e.message); } });
$("btn-group-members")?.addEventListener("click", ()=>{ if(state.group) openMembersModal(state.group); });

$("input").addEventListener("keydown", e=>{ const enter=state.settings.enterToSend; if(e.key==="Enter" && (enter? !e.shiftKey : (e.ctrlKey||e.metaKey))){ e.preventDefault(); sendMessage(); } });
$("input").addEventListener("input", ()=>{ const el=$("input"); el.style.height="auto"; el.style.height=Math.min(el.scrollHeight,160)+"px"; const now=Date.now(); if(now-state.lastTypingSent>2000){ state.lastTypingSent=now; if(state.group) wsSend({t:"typing", group:state.group}); else if(state.peer && !isSavedId(state.peer) && state.settings.sendTyping) wsSend({t:"typing", to:state.peer}); } });

// ---------------------------------------------------------------------------
// ایجاد گروه/کانال/مخاطب
// ---------------------------------------------------------------------------
function openCreateModal(kind="group"){
  $("create-modal").classList.remove("hidden");
  $("create-group-form").classList.toggle("hidden", kind==="contact");
  $("create-contact-form").classList.toggle("hidden", kind!=="contact");
  $("create-title").textContent= kind==="contact"? "افزودن مخاطب" : kind==="channel"? "ساخت کانال" : "ساخت گروه";
  if(kind!=="contact"){
    $("cg-type").value= kind==="channel"?"channel":"group";
    refreshMemberChecklist();
  }
}
function closeCreate(){ $("create-modal").classList.add("hidden"); }
$("btn-close-create")?.addEventListener("click", closeCreate);
$("create-backdrop")?.addEventListener("click", closeCreate);
$("btn-cancel-create")?.addEventListener("click", closeCreate);

function refreshMemberChecklist(){
  const box=$("cg-members"); box.innerHTML="";
  const all=[...state.users.values(), ...[...state.contacts.values()].map(c=> c.contact_user_id? state.users.get(c.contact_user_id): null).filter(Boolean)];
  const uniq=new Map();
  for(const u of all){ if(!u || u.id===state.me.id) continue; uniq.set(u.id,u); }
  // همچنین کاربران عمومی
  for(const u of state.users.values()){ if(u.id!==state.me.id) uniq.set(u.id,u); }
  const list=[...uniq.values()].slice(0,50);
  if(list.length===0){ box.innerHTML="<div class='dim' style='padding:8px'>کسی نیست — بعداً اضافه می‌کنی</div>"; return; }
  list.forEach(u=>{
    const row=document.createElement("label"); row.className="member-check";
    row.innerHTML=`<input type="checkbox" value="${u.id}" /> <div class="avatar" style="width:28px;height:28px;min-width:28px;font-size:0.8rem">${(u.name||"?").charAt(0)}</div> <span style="font-size:0.85rem">${u.name}</span>`;
    row.querySelector("input").addEventListener("change", e=>{ row.classList.toggle("selected", e.target.checked); });
    box.appendChild(row);
  });
}

$("btn-do-create")?.addEventListener("click", async()=>{
  const name=$("cg-name").value.trim(); if(name.length<2){ $("create-status").textContent="نام کوتاه است"; return; }
  const desc=$("cg-desc").value.trim();
  const type=$("cg-type").value;
  const checks=[...$("cg-members").querySelectorAll("input:checked")].map(i=>Number(i.value));
  $("create-status").textContent="در حال ساخت…";
  try{
    const r=await api("/groups",{method:"POST", body:JSON.stringify({name, description:desc, type, memberIds:checks})});
    state.groups.set(r.group.id, r.group); renderSidebar(); closeCreate(); toast("ساخته شد ✅");
    setActiveTab(type==="channel"?"channels":"groups");
    openGroup(r.group.id);
  }catch(e){ $("create-status").textContent="خطا: "+e.message; }
});

// مخاطب
$("btn-cc-by-tgid")?.addEventListener("click", async()=>{
  const tg=$("cc-tgid").value.trim(); if(!tg) return;
  const st=$("contact-create-status"); st.textContent="...";
  try{ const r=await api("/contacts",{method:"POST", body:JSON.stringify({tg_id:tg})}); state.contacts.set(r.contact.id, {...r.contact, user:r.user}); renderSidebar(); st.textContent="✅ اضافه شد"; $("cc-tgid").value=""; setTimeout(()=>st.textContent="",2000); }catch(e){ st.textContent="خطا: "+e.message; }
});
$("btn-cc-by-username")?.addEventListener("click", async()=>{
  const un=$("cc-username").value.trim(); if(!un) return;
  const st=$("contact-create-status"); st.textContent="...";
  try{ const r=await api("/contacts",{method:"POST", body:JSON.stringify({username:un})}); state.contacts.set(r.contact.id,{...r.contact, user:r.user}); renderSidebar(); st.textContent="✅ اضافه شد"; $("cc-username").value=""; }catch(e){ st.textContent="خطا: "+e.message; }
});
$("btn-cc-by-phone")?.addEventListener("click", async()=>{
  const phone=$("cc-phone").value.trim(); const nm=$("cc-name").value.trim()||phone;
  if(!phone) return; const st=$("contact-create-status"); st.textContent="...";
  try{ const r=await api("/contacts",{method:"POST", body:JSON.stringify({phone, name:nm})}); state.contacts.set(r.contact.id,r.contact); renderSidebar(); st.textContent="✅ اضافه شد"; $("cc-phone").value=""; $("cc-name").value=""; }catch(e){ st.textContent="خطا: "+e.message; }
});

// ---------------------------------------------------------------------------
// مودال اعضا
// ---------------------------------------------------------------------------
function openMembersModal(gid){
  $("members-modal").classList.remove("hidden");
  refreshMembersList(gid);
}
function closeMembers(){ $("members-modal").classList.add("hidden"); }
$("btn-close-members")?.addEventListener("click", closeMembers);
$("members-backdrop")?.addEventListener("click", closeMembers);

async function refreshMembersList(gid){
  const box=$("members-list"); box.innerHTML="در حال بارگذاری…";
  try{
    const r=await api(`/groups/${gid}`); const g=r.group; $("members-title").textContent=`اعضای ${g.name} — ${g.type==="channel"?"کانال":"گروه"}`;
    box.innerHTML="";
    for(const m of r.members){
      const row=document.createElement("div"); row.className="session-item";
      const avatar=document.createElement("div"); avatar.className="avatar"; avatar.style.width="36px"; avatar.style.height="36px"; avatar.style.minWidth="36px"; setAvatar(avatar,m.user);
      const meta=document.createElement("div"); meta.className="session-meta"; meta.style.marginRight="10px";
      meta.innerHTML=`<div class="session-title">${m.user.name} ${m.role==="owner"?"👑":m.role==="admin"?"⭐":""}</div><div class="session-time">${m.role} — @${m.user.username||m.user.id}</div>`;
      const actions=document.createElement("div"); actions.style.display="flex"; actions.style.gap="6px";
      if(m.user.id!==state.me.id){
        const rm=document.createElement("button"); rm.className="btn btn-ghost"; rm.style.padding="4px 8px"; rm.textContent="حذف"; rm.addEventListener("click", async()=>{ if(!confirm("حذف؟")) return; try{ await api(`/groups/${gid}/members/${m.user.id}`,{method:"DELETE"}); refreshMembersList(gid); renderSidebar(); }catch(e){ toast(e.message); } });
        actions.appendChild(rm);
      }
      const wrap=document.createElement("div"); wrap.style.display="flex"; wrap.style.alignItems="center"; wrap.append(avatar,meta); row.append(wrap,actions); box.appendChild(row);
    }
  }catch(e){ box.textContent="خطا: "+e.message; }
}

$("btn-add-member")?.addEventListener("click", async()=>{
  const gid=state.group; if(!gid) return;
  const uid=Number($("add-member-id").value.trim()); if(!uid) return;
  const st=$("members-status"); st.textContent="در حال افزودن…";
  try{ await api(`/groups/${gid}/members`,{method:"POST", body:JSON.stringify({userId:uid})}); st.textContent="✅ اضافه شد"; $("add-member-id").value=""; refreshMembersList(gid); renderSidebar(); }catch(e){ st.textContent="خطا: "+e.message; }
});
$("btn-leave-group")?.addEventListener("click", async()=>{
  const gid=state.group; if(!gid) return; if(!confirm("از گروه خارج شوی؟")) return;
  try{ await api(`/groups/${gid}/members/${state.me.id}`,{method:"DELETE"}); state.groups.delete(gid); state.group=null; closeMembers(); $("app").classList.remove("chat-open"); $("chat-view").classList.add("hidden"); $("empty-state").classList.remove("hidden"); renderSidebar(); toast("خارج شدی"); }catch(e){ toast(e.message); }
});
$("btn-copy-invite")?.addEventListener("click", async()=>{
  const gid=state.group; if(!gid) return;
  try{ const r=await api(`/groups/${gid}/invite`,{method:"POST"}); await navigator.clipboard.writeText(r.link); toast("لینک کپی شد: "+r.link); }catch(e){ toast(e.message); }
});

// ---------------------------------------------------------------------------
// پروفایل
// ---------------------------------------------------------------------------
async function refreshSettingsData(){
  if(!state.me) return;
  const big=$("set-avatar-big"); if(big){ setAvatar(big,state.me); big.textContent=(state.me.name||"?").trim().charAt(0)||"?"; }
  $("set-profile-name")&&($("set-profile-name").textContent=state.me.name||"—");
  $("set-profile-sub")&&($("set-profile-sub").textContent= state.me.username?"@"+state.me.username:`ID ${state.me.id}`);
  $("set-name-input")&&($("set-name-input").value=state.me.name||"");
  $("set-info-id")&&($("set-info-id").textContent=String(state.me.id));
  $("set-info-tgid")&&($("set-info-tgid").textContent=String(state.me.tg_id||"—"));
  $("set-info-username")&&($("set-info-username").textContent= state.me.username?"@"+state.me.username:"ندارد");
  $("set-info-joined")&&($("set-info-joined").textContent= state.me.created_at?fmtDateTime(state.me.created_at):"—");
  loadSessions(); calcStorage();
  try{ const h=await api("/health"); if($("about-uptime")) $("about-uptime").textContent=Math.floor(h.uptime/60)+"m"; }catch{}
}
async function saveProfileName(){
  const inp=$("set-name-input"); const st=$("set-name-status"); if(!inp) return;
  const name=inp.value.trim(); if(name.length<2){ if(st) st.textContent="نام کوتاه است"; return; }
  if(st) st.textContent="در حال ذخیره…";
  try{ const r=await api("/me",{method:"PUT",body:JSON.stringify({name})}); state.me=r.user; $("me-name").textContent=state.me.name; setAvatar($("me-avatar"),state.me); const big=$("set-avatar-big"); if(big) setAvatar(big,state.me); $("set-profile-name").textContent=state.me.name; st.textContent="✅ ذخیره شد"; renderSidebar(); setTimeout(()=>{ st.textContent=""; },2000); }catch(e){ st.textContent="خطا: "+e.message; }
}
async function loadSessions(){
  const list=$("sessions-list"); if(!list) return; list.textContent="در حال بارگذاری…";
  try{ const r=await api("/sessions"); list.innerHTML=""; if(r.sessions.length===0){ list.textContent="نشستی نیست"; return; } r.sessions.forEach(s=>{ const item=document.createElement("div"); item.className="session-item"+(s.current?" current":""); const meta=document.createElement("div"); meta.className="session-meta"; const title=document.createElement("div"); title.className="session-title"; title.textContent=s.current?"این دستگاه — فعلی":`نشست ${s.preview}…`; const time=document.createElement("div"); time.className="session-time"; time.textContent=fmtDateTime(s.created_at); meta.append(title,time); const badge=document.createElement("div"); if(s.current){ badge.className="session-badge"; badge.textContent="فعلی"; } item.append(meta,badge); list.appendChild(item); }); }catch{ list.textContent="خطا"; }
}
async function revokeOtherSessions(){ const st=$("sessions-status"); if(!confirm("از تمام نشست‌های دیگر خارج شوی؟")) return; if(st) st.textContent="در حال خروج…"; try{ const r=await api("/sessions/revoke-others",{method:"POST"}); if(st) st.textContent=`✅ ${fa(r.revoked)} نشست بسته شد`; loadSessions(); }catch(e){ if(st) st.textContent="خطا: "+e.message; } }
function calcStorage(){ const txt=$("storage-text"); const fill=$("storage-fill"); try{ let total=0; for(let i=0;i<localStorage.length;i++){ const k=localStorage.key(i); const v=localStorage.getItem(k)||""; total+=k.length+v.length; } const kb=(total/1024).toFixed(1); const pct=Math.min(100,(total/(5*1024*1024))*100); if(txt) txt.textContent=`حدود ${kb} KB از 5MB استفاده شده`; if(fill) fill.style.width=pct+"%"; }catch{ if(txt) txt.textContent="نامشخص"; } }
async function exportChats(){ try{ const r=await api("/export"); const blob=new Blob([JSON.stringify(r,null,2)],{type:"application/json"}); const url=URL.createObjectURL(blob); const a=document.createElement("a"); a.href=url; a.download=`furina-cloud-export-${Date.now()}.json`; a.click(); setTimeout(()=>URL.revokeObjectURL(url),2000); toast("خروجی ابری دانلود شد"); }catch{ toast("خطا در خروجی"); } }

// خروج
$("btn-logout").addEventListener("click", async()=>{ try{ await api("/logout",{method:"POST"}); }catch{} localStorage.removeItem("payam_token"); location.reload(); });

// ---------------------------------------------------------------------------
// آنبوردینگ پروفایل — برای کاربر جدید که نباید به همه نشون داده بشه
// ---------------------------------------------------------------------------
function openOnboarding(){
  const m=$("onboarding-modal"); if(!m) return;
  m.classList.remove("hidden");
  $("ob-name").value=state.me.name||"";
  $("ob-username").value=state.me.username||"";
  $("ob-bio").value=(state.me).bio||"";
  $("ob-id").value=String(state.me.id);
}
function closeOnboarding(){ $("onboarding-modal")?.classList.add("hidden"); }

$("btn-ob-copy-id")?.addEventListener("click", ()=>{
  const v=$("ob-id").value; navigator.clipboard?.writeText(v).then(()=>toast("کپی شد"));
});

$("btn-ob-save")?.addEventListener("click", async()=>{
  const name=$("ob-name").value.trim();
  const username=$("ob-username").value.trim().replace(/^@/,"");
  const bio=$("ob-bio").value.trim();
  const st=$("ob-status");
  if(name.length<2){ st.textContent="نام کوتاهه"; return; }
  if(username.length<3){ st.textContent="یوزرنیم حداقل ۳ حرف"; return; }
  if(!/^[a-zA-Z0-9_]{3,32}$/.test(username)){ st.textContent="یوزرنیم فقط a-z 0-9 _"; return; }
  st.textContent="در حال ذخیره...";
  try{
    const r=await api("/me",{method:"PUT", body:JSON.stringify({name, username, bio})});
    state.me=r.user;
    $("me-name").textContent=state.me.name;
    $("me-username").textContent=state.me.username? "@"+state.me.username : "";
    setAvatar($("me-avatar"),state.me);
    closeOnboarding();
    toast("✅ پروفایل ساخته شد — حالا فقط مخاطبین و هم‌گروهی‌ها تو رو می‌بینن");
    renderSidebar();
  }catch(e){
    if(e.code==="username_taken") st.textContent="این یوزرنیم گرفته شده";
    else if(e.code==="username_bad_format") st.textContent="فرمت یوزرنیم اشتباهه";
    else st.textContent="خطا: "+e.message;
  }
});

// ---------------------------------------------------------------------------
// پروفایل بقیه — باز کردن با کلیک روی آواتار
// ---------------------------------------------------------------------------
let profileViewId=null;
function openProfile(userId){
  const u=state.users.get(userId) || (state.me.id===userId? state.me : null);
  if(!u && userId!==state.me.id){
    // از سرور بگیر
    api(`/users/${userId}`).then(r=>{ showProfileModal(r.user); }).catch(()=>toast("پروفایل پیدا نشد"));
    return;
  }
  const target = u || state.me;
  showProfileModal(target);
}
function showProfileModal(u){
  profileViewId=u.id;
  const m=$("profile-modal"); m.classList.remove("hidden");
  const av=$("pv-avatar"); setAvatar(av,u); av.textContent=(u.name||"?").trim().charAt(0)||"?";
  $("pv-name").textContent=u.name||"—";
  $("pv-username").textContent=u.username? "@"+u.username : "یوزرنیم نداره";
  $("pv-bio").textContent=(u.bio||"— بیو نداره —")+"";
  $("pv-id").textContent=String(u.id);
  $("pv-tgid").textContent=String(u.tg_id||"—");
}
function closeProfile(){ $("profile-modal")?.classList.add("hidden"); profileViewId=null; }
$("btn-close-profile")?.addEventListener("click", closeProfile);
$("profile-backdrop")?.addEventListener("click", closeProfile);
$("btn-pv-chat")?.addEventListener("click", ()=>{ if(!profileViewId) return; closeProfile(); if(profileViewId===state.me.id) openPrivate(state.me.id); else openPrivate(profileViewId); });
$("btn-pv-add-contact")?.addEventListener("click", async()=>{
  if(!profileViewId) return;
  try{
    const r=await api("/contacts",{method:"POST", body:JSON.stringify({tg_id: (state.users.get(profileViewId)?.tg_id) || undefined, username: state.users.get(profileViewId)?.username})});
    toast("افزوده شد به مخاطبین");
  }catch(e){ toast(e.message); }
});
$("me-area")?.addEventListener("click", ()=> openProfile(state.me.id));
$("peer-avatar")?.addEventListener("click", ()=>{ if(state.peer) openProfile(state.peer); else if(state.group){ /* گروه */ } });
$("peer-meta-area")?.addEventListener("click", ()=>{ if(state.peer) openProfile(state.peer); });

// ---------------------------------------------------------------------------
// آپلود فایل — عکس، ویدیو، گیف، هر فایلی
// ---------------------------------------------------------------------------
const fileInput=$("file-input");
$("btn-attach")?.addEventListener("click", ()=> fileInput?.click());
fileInput?.addEventListener("change", async()=>{
  const files=fileInput.files; if(!files||files.length===0) return;
  for(const f of Array.from(files)){
    await uploadAndSend(f);
  }
  fileInput.value="";
});

async function uploadAndSend(file){
  const bar=$("upload-progress"); const fill=$("upload-bar"); const txt=$("upload-text");
  if(bar) bar.classList.remove("hidden");
  if(fill) fill.style.width="10%";
  if(txt) txt.textContent=`در حال آپلود ${file.name}...`;

  try{
    const fd=new FormData();
    fd.append("file", file);
    const h={}; if(state.token) h.Authorization="Bearer "+state.token;
    const res=await fetch("/api/upload", {method:"POST", headers:h, body:fd});
    const data=await res.json();
    if(!res.ok) throw new Error(data.message||data.error||"خطای آپلود");
    if(fill) fill.style.width="80%";
    // حالا پیام با فایل بفرست
    const fileInfo=data.file;
    const text=$("input").value.trim() || file.name;
    $("input").value="";
    // شبیه sendMessage ولی با فایل
    const temp="t"+Date.now()+Math.random().toString(36).slice(2,5);
    const optimistic={ id:-1, sender:state.me.id, recipient:state.peer||state.me.id, text, ts:Date.now(), group_id:state.group||null, file_url:fileInfo.url, file_name:fileInfo.name, file_size:fileInfo.size, mime:fileInfo.mime, msg_type:fileInfo.type, read_at:null };
    state.msgs.push(optimistic);
    const el=buildBubble(optimistic); el.classList.add("pending"); $("messages").appendChild(el); state.pending.set(temp,el); scrollDown(true);
    wsSend({ t:"msg", to:state.peer, group:state.group, text, temp, file:fileInfo });
    // فال‌بک HTTP
    setTimeout(()=>{
      if(state.pending.has(temp)){
        const payload= state.group? {group:state.group, text, file:fileInfo} : {to:state.peer, text, file:fileInfo};
        api("/messages",{method:"POST", body:JSON.stringify(payload)}).then(r=>{
          if(!state.pending.has(temp)) return;
          onAck({id:r.message.id, to:state.peer, group:state.group, text:r.message.text, ts:r.message.ts, temp, file:fileInfo});
        }).catch(()=>{});
      }
    },2500);

    if(fill) fill.style.width="100%";
    setTimeout(()=>{ if(bar) bar.classList.add("hidden"); if(fill) fill.style.width="0%"; }, 800);
  }catch(e){
    toast("خطای آپلود: "+e.message);
    const bar=$("upload-progress"); if(bar) bar.classList.add("hidden");
  }
}

// درگ اند دراپ فایل
const chatViewEl=$("chat-view");
if(chatViewEl){
  chatViewEl.addEventListener("dragover", e=>{ e.preventDefault(); chatViewEl.style.background="rgba(58,134,200,0.06)"; });
  chatViewEl.addEventListener("dragleave", ()=>{ chatViewEl.style.background=""; });
  chatViewEl.addEventListener("drop", async e=>{
    e.preventDefault(); chatViewEl.style.background="";
    const files=e.dataTransfer?.files; if(!files) return;
    for(const f of Array.from(files)) await uploadAndSend(f);
  });
}

// شروع — با حریم خصوصی و بدون لاگ‌اوت علکی وقتی کروم بسته میشه
(function boot(){
  applySettings(); initSettingsUI();
  if(state.token){
    api("/me").then(r=>{
      state.me=r.user;
      if(r.user.needs_onboarding || !r.user.username || !r.user.bio){
        setTimeout(()=>{ enterApp().then(()=>{ if(r.user.needs_onboarding || !state.me.username) openOnboarding(); }); }, 300);
      }else{
        enterApp();
      }
    }).catch(e=>{
      // فقط اگر توکن واقعاً بی‌اعتباره لاگ‌اوت کن
      if(e.code==="unauthorized"){
        localStorage.removeItem("payam_token");
        state.token=null;
        showLogin();
      }else{
        // نت قطعه یا سرور خواب — لاگین رو نشون نده، با همون توکن بمون و دوباره تلاش کن
        console.warn("boot /me failed, keeping token", e);
        // سعی کن مستقیم بری تو اپ با کش، یا لاگین رو نشون بده ولی توکن رو نگه دار
        const cachedMe = state.me;
        if(cachedMe){
          enterApp();
        }else{
          // اگه تا 3 ثانیه دیگه هم نت نیومد، لاگین رو نشون بده ولی توکن پاک نکن
          setTimeout(()=>{
            api("/me").then(rr=>{ state.me=rr.user; enterApp(); }).catch(()=>{ showLogin(); });
          }, 2000);
        }
      }
    });
    return;
  }
  showLogin();
})();
