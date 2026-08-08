import http from "http";
import { WebSocketServer, WebSocket } from "ws";
import { userByToken } from "./auth";
import {
  User,
  listUsers,
  insertMessage,
  unreadCounts,
  markRead,
  touchLastSeen,
  getUserById,
  getLastMessages,
} from "./db";

interface PublicUser {
  id: number;
  name: string;
  username: string | null;
  online: boolean;
  last_seen: number | null;
}

const online = new Map<number, Set<WebSocket>>();

function publicUser(u: User): PublicUser {
  return {
    id: u.id,
    name: u.name,
    username: u.username,
    online: online.has(u.id),
    last_seen: u.last_seen,
  };
}

export function isOnline(userId: number): boolean {
  return online.has(userId);
}

function send(ws: WebSocket, obj: unknown): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

function sendToUser(userId: number, obj: unknown, except?: WebSocket): void {
  const set = online.get(userId);
  if (!set) return;
  const data = JSON.stringify(obj);
  for (const ws of set) {
    if (ws !== except && ws.readyState === WebSocket.OPEN) ws.send(data);
  }
}

function broadcast(obj: unknown): void {
  const data = JSON.stringify(obj);
  for (const set of online.values()) {
    for (const ws of set) {
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
    }
  }
}

/** وقتی کاربر جدیدی ثبت‌نام می‌کند، به همه اطلاع بده */
export function announceUser(u: User): void {
  broadcast({ t: "user", user: publicUser(u) });
}

/** ارسال یک رویداد به یک کاربر خاص */
export function notifyUser(userId: number, obj: unknown): void {
  sendToUser(userId, obj);
}

export function initWs(server: http.Server): void {
  const wss = new WebSocketServer({ server, path: "/ws" });

  wss.on("connection", (ws, req) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const token = url.searchParams.get("token") ?? undefined;
    const user = userByToken(token);
    if (!user) {
      send(ws, { t: "error", error: "unauthorized" });
      ws.close();
      return;
    }

    let set = online.get(user.id);
    const firstConn = !set || set.size === 0;
    if (!set) {
      set = new Set();
      online.set(user.id, set);
    }
    set.add(ws);

    const users = listUsers().filter((u) => u.id !== user.id);
    send(ws, {
      t: "hello",
      me: publicUser({ ...user, online: true } as User),
      users: users.map(publicUser),
      unread: unreadCounts(user.id),
      last: getLastMessages(user.id),
    });

    if (firstConn) {
      broadcast({ t: "presence", id: user.id, online: true });
    }

    // نگه‌داشتن اتصال زنده
    let alive = true;
    const pingTimer = setInterval(() => {
      if (!alive) {
        ws.terminate();
        return;
      }
      alive = false;
      try {
        ws.ping();
      } catch {
        /* ignore */
      }
    }, 30000);
    ws.on("pong", () => {
      alive = true;
    });

    ws.on("message", (raw) => {
      try {
        handleMessage(user, ws, raw);
      } catch (e) {
        console.error("[ws] خطا در پردازش پیام:", e);
      }
    });

    ws.on("close", () => {
      clearInterval(pingTimer);
      const s = online.get(user.id);
      if (!s) return;
      s.delete(ws);
      if (s.size === 0) {
        online.delete(user.id);
        touchLastSeen(user.id);
        const fresh = getUserById(user.id);
        broadcast({
          t: "presence",
          id: user.id,
          online: false,
          last_seen: fresh?.last_seen ?? Date.now(),
        });
      }
    });
  });
}

function handleMessage(me: User, ws: WebSocket, raw: unknown): void {
  let msg: any;
  try {
    msg = JSON.parse(String(raw));
  } catch {
    return;
  }

  switch (msg?.t) {
    case "msg": {
      const to = Number(msg.to);
      const text = typeof msg.text === "string" ? msg.text.trim().slice(0, 4096) : "";
      if (!to || !text) return;
      const peer = getUserById(to);
      if (!peer) return;
      const row = insertMessage(me.id, peer.id, text);
      // پیام به خود (Saved Messages): بلافاصله خوانده‌شده است
      if (peer.id === me.id) markRead(me.id, me.id);
      const event = {
        t: "msg",
        id: row.id,
        from: me.id,
        to: peer.id,
        text: row.text,
        ts: row.ts,
        read: peer.id === me.id,
      };
      sendToUser(peer.id, event);
      // تأیید به فرستنده (و سایر دستگاه‌هایش)
      sendToUser(me.id, { ...event, ack: true, temp: msg.temp ?? null });
      break;
    }

    case "typing": {
      const to = Number(msg.to);
      if (to && to !== me.id) sendToUser(to, { t: "typing", from: me.id });
      break;
    }

    case "read": {
      const peer = Number(msg.peer);
      if (!peer) return;
      const changed = markRead(me.id, peer);
      if (changed > 0) sendToUser(peer, { t: "read", by: me.id });
      break;
    }

    case "ping": {
      send(ws, { t: "pong" });
      break;
    }
  }
}
