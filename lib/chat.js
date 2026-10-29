'use strict';

/**
 * Pond · 鱼汛（实时聊天）
 *
 * 用 SSE 而不是 WebSocket：
 *   - 浏览器有原生 EventSource，不用写重连逻辑（它自己会重连）
 *   - 服务端只是一个不结束的 HTTP 响应，零依赖、不用实现帧协议
 *   - 发送走普通 POST，聊天这种「一秒钟几条」的量完全够用
 * 代价是单向广播，发消息要单独发请求——对聊天室来说不是问题。
 *
 * 这个模块只管「谁连着、往谁那儿写」，不碰数据库。
 */

const MAX_CLIENTS = 300;
const MAX_PER_USER = 3;
const MAX_PER_IP = 12;
const HEARTBEAT_MS = 25000;

/** @type {Set<{res:import('node:http').ServerResponse, ip:string, user:object|null}>} */
const clients = new Set();

function write(res, chunk) {
  try {
    if (res.writableEnded || res.destroyed) return false;
    res.write(chunk);
    return true;
  } catch {
    return false;
  }
}

function frame(event, data) {
  return 'event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n';
}

function broadcast(event, data) {
  const payload = frame(event, data);
  for (const c of clients) write(c.res, payload);
}

/** 去重后的在线鱼（同一人多开页面只算一条） */
function onlineUsers() {
  const seen = new Map();
  for (const c of clients) {
    if (!c.user) continue;
    if (!seen.has(c.user.id)) {
      seen.set(c.user.id, {
        id: c.user.id,
        fishName: c.user.fish_name,
        fishType: c.user.fish_type
      });
    }
  }
  return Array.from(seen.values());
}

function presence() {
  const online = onlineUsers();
  return { online, count: online.length };
}

function broadcastPresence() {
  broadcast('presence', presence());
}

function countIp(ip) {
  let n = 0;
  for (const c of clients) if (c.ip === ip) n += 1;
  return n;
}

function countUser(userId) {
  let n = 0;
  for (const c of clients) if (c.user && c.user.id === userId) n += 1;
  return n;
}

function stats() {
  return { connections: clients.size, online: presence().count };
}

/** 关服务器时把长连接一并收掉，否则 server.close() 会一直等 */
function closeAll() {
  for (const c of clients) {
    try { c.res.end(); } catch { /* 已经断了就算了 */ }
  }
  clients.clear();
}

/**
 * 把一次 GET 请求升级成 SSE 流。
 * 成功时响应已被接管，调用方不要再写任何东西。
 */
function attach(req, res, ip, user) {
  if (clients.size >= MAX_CLIENTS) return { error: 'chat_full' };
  // 同一个人开太多窗口，先拦这个——比按 IP 拦更准
  if (user && countUser(user.id) >= MAX_PER_USER) return { error: 'too_many_windows' };
  // IP 是兜底：同一个办公室/学校出口共享一个 IP，所以这个数不能太小
  if (countIp(ip) >= MAX_PER_IP) return { error: 'too_many_connections' };

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  // 先冲出去，否则浏览器拿不到响应头就不会进入 open 状态
  if (typeof res.flushHeaders === 'function') res.flushHeaders();
  write(res, ': connected\n\n');

  // 长连接不能有任何超时，否则 Node 或中间的 nginx 会把它掐掉
  res.setTimeout(0);
  if (req.socket) {
    req.socket.setTimeout(0);
    req.socket.setNoDelay(true);
    req.socket.setKeepAlive(true, 60000);
  }

  const client = { res, ip, user };
  clients.add(client);

  // 先告诉这条鱼自己是谁、现在塘里有谁
  write(res, frame('hello', {
    me: user ? { id: user.id, fishName: user.fish_name, fishType: user.fish_type } : null,
    online: presence().online,
    count: presence().count
  }));

  const timer = setInterval(() => write(res, ': ping\n\n'), HEARTBEAT_MS);
  if (typeof timer.unref === 'function') timer.unref();

  let closed = false;
  const cleanup = () => {
    if (closed) return;
    closed = true;
    clearInterval(timer);
    if (clients.delete(client)) broadcastPresence();
  };
  req.on('close', cleanup);
  req.on('error', cleanup);
  res.on('close', cleanup);
  res.on('error', cleanup);

  broadcastPresence();
  return { ok: true };
}

module.exports = {
  attach,
  broadcast,
  presence,
  stats,
  closeAll,
  MAX_CLIENTS,
  MAX_PER_USER,
  MAX_PER_IP
};
