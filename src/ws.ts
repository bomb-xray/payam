import http from "http";
import { WebSocketServer, WebSocket } from "ws";
import { userByToken } from "./auth";
import {
  User,
  listUsers,
  insertMessage,
  insertGroupMessage,
  unreadCounts,
  unreadGroupCounts,
  markRead,
  touchLastSeen,
  getUserById,
  getLastMessages,
  listGroupsForUser,
  isGroupMember,
  getGroupById,
  getGroupMembers,
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

function publicGroup(g: any) {
  return {
    id: g.id,
    name: g.name,
    description: g.description,
    type: g.type,
    invite_token: g.invite_token,
    member_count: g.member_count,
    role: g.role,
    created_at: g.created_at,
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

export function broadcastGroup(groupId: number, obj: unknown): void {
  const members = getGroupMembers(groupId);
  for (const m of members) {
    sendToUser(m.user.id, obj);
  }
}

export function announceUser(u: User): void {
  broadcast({ t: "user", user: publicUser(u) });
}

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
    const groups = listGroupsForUser(user.id).map(publicGroup);

    send(ws, {
      t: "hello",
      me: publicUser({ ...user, online: true } as User),
      users: users.map(publicUser),
      groups,
      unread: unreadCounts(user.id),
      unreadGroups: unreadGroupCounts(user.id),
      last: getLastMessages(user.id),
    });

    if (firstConn) {
      broadcast({ t: "presence", id: user.id, online: true });
    }

    let alive = true;
    const pingTimer = setInterval(() => {
      if (!alive) {
        ws.terminate();
        return;
      }
      alive = false;
      try {
        ws.ping();
      } catch {}
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
      const text = typeof msg.text === "string" ? msg.text.trim().slice(0, 4096) : "";
      if (!text) return;

      // گروه
      if (msg.group) {
        const gid = Number(msg.group);
        if (!gid) return;
        if (!isGroupMember(gid, me.id)) {
          send(ws, { t: "error", error: "not_member" });
          return;
        }
        const g = getGroupById(gid);
        if (!g) return;
        if (g.type === "channel") {
          const members = getGroupMembers(gid);
          const myRole = members.find((m) => m.user.id === me.id)?.role;
          if (!myRole || !["owner", "admin"].includes(myRole)) {
            send(ws, { t: "error", error: "channel_readonly" });
            return;
          }
        }
        let row;
        try {
          row = insertGroupMessage(me.id, gid, text);
        } catch (e) {
          console.error("[ws] insertGroupMessage fail", e);
          send(ws, { t: "error", error: "db_fail" });
          return;
        }
        const event = {
          t: "msg",
          id: row.id,
          from: me.id,
          group: gid,
          text: row.text,
          ts: row.ts,
        };
        // به همه اعضای گروه + تأیید به فرستنده
        broadcastGroup(gid, event);
        const ack = { ...event, ack: true, temp: msg.temp ?? null };
        send(ws, ack);
        // به بقیه دستگاه‌های فرستنده هم ack برود که pending پاک شود
        sendToUser(me.id, ack, ws);
        break;
      }

      // پیام شخصی
      const to = Number(msg.to);
      if (!to) return;
      const peer = getUserById(to);
      if (!peer) {
        send(ws, { t: "error", error: "no_peer" });
        return;
      }
      let row;
      try {
        row = insertMessage(me.id, peer.id, text, null);
      } catch (e) {
        console.error("[ws] insertMessage failed", e);
        send(ws, { t: "error", error: "db_fail" });
        return;
      }
      if (peer.id === me.id) {
        const { markRead } = require("./db");
        markRead(me.id, me.id);
      }

      const event = {
        t: "msg",
        id: row.id,
        from: me.id,
        to: peer.id,
        text: row.text,
        ts: row.ts,
        read: peer.id === me.id,
      };

      if (peer.id === me.id) {
        const ack = { ...event, ack: true, temp: msg.temp ?? null };
        send(ws, ack);
        sendToUser(me.id, ack, ws);
        sendToUser(me.id, event, ws);
      } else {
        sendToUser(peer.id, event);
        const ack = { ...event, ack: true, temp: msg.temp ?? null };
        send(ws, ack);
        sendToUser(me.id, ack, ws);
      }
      break;
    }

    case "typing": {
      const to = Number(msg.to);
      const group = msg.group ? Number(msg.group) : null;
      if (group) {
        const members = getGroupMembers(group);
        for (const m of members) {
          if (m.user.id === me.id) continue;
          sendToUser(m.user.id, { t: "typing", from: me.id, group });
        }
      } else if (to && to !== me.id) {
        sendToUser(to, { t: "typing", from: me.id });
      }
      break;
    }

    case "read": {
      const peer = Number(msg.peer);
      if (!peer) return;
      const { markRead } = require("./db");
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
