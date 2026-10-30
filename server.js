'use strict';

/**
 * Pond · 服务端入口
 * 零依赖：Node 内置 http + node:sqlite。
 *   node server.js            # 默认 http://localhost:3000
 *   POND_PORT=8080 node server.js
 */

const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');

const { db } = require('./lib/db');
const auth = require('./lib/auth');
const chat = require('./lib/chat');
const { handle } = require('./lib/api');
const render = require('./lib/render');
const { serveStatic, fail } = require('./lib/http');
const { seed, DEMO_PASSWORD } = require('./lib/seed');
const site = require('./pond.config');

const PORT = parseInt(process.env.POND_PORT, 10) || 3000;
const HOST = process.env.POND_HOST || '127.0.0.1';
const PUBLIC_DIR = path.join(__dirname, 'public');

const config = {
  name: process.env.POND_NAME || site.name,
  slug: process.env.POND_SLUG || site.slug,
  tagline: process.env.POND_TAGLINE || site.tagline,
  desc: process.env.POND_DESC || site.desc,
  rules: site.rules || [],
  tags: site.tags || [],
  trust: site.trust || {}
};

/* ---------- 配置自检 ---------- */

function checkConfig() {
  if (!config.name) throw new Error('pond.config.js: name 不能为空');
  if (!Array.isArray(config.tags)) throw new Error('pond.config.js: tags 必须是数组');
  if (!Array.isArray(config.rules)) throw new Error('pond.config.js: rules 必须是数组');
  if (config.tags.length > 12) {
    console.warn(`  ⚠ 塘口有 ${config.tags.length} 个，侧栏会很长，建议控制在 12 个以内`);
  }
  if (config.tags.length === 0) {
    console.warn('  ⚠ 没有配置塘口，发帖时标签选择器会是空的');
  }
}

checkConfig();
auth.configureTrust(config.trust);

/* ---------- 启动 ---------- */

const seedResult = seed({ tags: config.tags });

/**
 * POND_ADMIN=yourname：把这个账号提升成管理员。
 * 注册时已经处理过一次，这里兜住「先注册了、后来才想起来设」的情况。
 */
function promoteAdmin() {
  const who = String(process.env.POND_ADMIN || '').trim().toLowerCase();
  if (!who) return null;
  const row = db.prepare('SELECT id, role FROM users WHERE username = ?').get(who);
  if (!row) return { username: who, pending: true };
  if (row.role !== 'admin') {
    db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(row.id);
  }
  return { username: who, pending: false };
}

const adminResult = promoteAdmin();
auth.purgeExpiredSessions();
setInterval(() => auth.purgeExpiredSessions(), 60 * 60 * 1000).unref();

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'Referrer-Policy': 'same-origin',
  'Content-Security-Policy':
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; " +
    "script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'"
};

/**
 * 取客户端 IP，用于限流和聊天室连接数上限。
 *
 * 默认只认 socket 地址。直连公网时 X-Forwarded-For 是客户端自己写的头，
 * 谁都能填一个假 IP，换着填就绕过了所有按 IP 的限流——包括登录爆破。
 * 只有确实挂在反向代理后面（Caddy / Nginx / Cloudflare）才设 POND_TRUST_PROXY=1。
 */
const TRUST_PROXY = process.env.POND_TRUST_PROXY === '1';

function clientIp(req) {
  if (TRUST_PROXY) {
    const fwd = req.headers['x-forwarded-for'];
    if (fwd) return String(fwd).split(',')[0].trim();
  }
  return req.socket.remoteAddress || '0.0.0.0';
}

/**
 * 站点对外的绝对地址，canonical / sitemap 都要用。
 * 设了 POND_BASE_URL 就用它；否则从请求头里推，挂在反向代理后面也认得。
 */
function baseUrlOf(req) {
  const fixed = String(process.env.POND_BASE_URL || '').trim();
  if (fixed) return fixed.replace(/\/+$/, '');
  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() ||
    (req.socket.encrypted ? 'https' : 'http');
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || (HOST + ':' + PORT))
    .split(',')[0].trim();
  return proto + '://' + host;
}

function sendText(res, status, body, type, extra) {
  const buf = Buffer.from(body, 'utf8');
  res.writeHead(status, Object.assign({
    'Content-Type': type,
    'Content-Length': buf.length,
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff'
  }, extra || {}));
  res.end(buf);
}

const server = http.createServer(async (req, res) => {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);

  const url = req.url || '/';

  if (!url.startsWith('/api/')) {
    const rawPath = url.split('?')[0];

    // 给爬虫的两份文件
    if (rawPath === '/robots.txt') {
      return sendText(res, 200, render.robotsTXT(baseUrlOf(req)), 'text/plain; charset=utf-8');
    }
    if (rawPath === '/sitemap.xml') {
      return sendText(res, 200, render.sitemapXML(baseUrlOf(req)), 'application/xml; charset=utf-8');
    }

    // 有内容的页面：服务端先渲染一遍，爬虫拿到的就不是空壳了
    const page = render.renderRoute(rawPath, config, baseUrlOf(req));
    if (page) {
      return sendText(res, page.status, page.html, 'text/html; charset=utf-8', {
        'X-Robots-Tag': page.noindex ? 'noindex, follow' : 'index, follow'
      });
    }

    if (serveStatic(res, PUBLIC_DIR, url) !== false) return;
    // 单页应用回退：无扩展名的路径一律交给前端路由（/chat、/basket 这些）
    if (!path.extname(rawPath)) {
      if (serveStatic(res, PUBLIC_DIR, '/index.html') !== false) return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found');
    return;
  }

  const cookies = auth.parseCookies(req.headers.cookie);
  const token = cookies[auth.COOKIE_NAME] || null;
  const user = auth.userBySession(token);

  try {
    await handle(req, res, { user, token, ip: clientIp(req), config });
    // 兜底：任何分支忘了响应时不能让请求一直挂着
    if (!res.writableEnded && !res.headersSent) {
      fail(res, 500, 'no_response', '服务器没有响应');
    }
  } catch (err) {
    if (res.headersSent) return;
    if (err && err.status) {
      fail(res, err.status, err.code || 'error', err.message, err.extra);
    } else {
      console.error('[pond] 未处理的错误:', err);
      fail(res, 500, 'internal', '服务器出了点问题');
    }
  }
});

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    const where = `http://${HOST}:${PORT}`;
    console.log('');
    console.log(`  ${config.name} 已启动`);
    console.log(`  ${where}`);
    console.log('');
    if (seedResult.seeded) {
      console.log(`  已写入示例数据：${seedResult.users} 位养鱼人、${seedResult.posts} 层楼、${seedResult.chat} 条鱼汛`);
      console.log(`  演示账号：admin / ${DEMO_PASSWORD}（管理员）`);
      console.log(`            qingning / ${DEMO_PASSWORD}（普通成员）`);
      console.log('');
    } else if (seedResult.reason === 'custom-config') {
      console.log('  检测到自定义塘口，已跳过示例数据——这是一个空塘。');
      console.log('');
    }

    if (adminResult && adminResult.pending) {
      console.log(`  POND_ADMIN=${adminResult.username}，但这个账号还没注册。`);
      console.log('  去注册它，注册完自动就是管理员。');
      console.log('');
    } else if (adminResult) {
      console.log(`  管理员账号：${adminResult.username}`);
      console.log('');
    }

    for (const w of deployWarnings()) console.log(`  ⚠ ${w}\n`);
    const note = deployNote();
    if (note) console.log(`  ${note}\n`);
  });
}

/**
 * 上线前的自检。不阻止启动——本地开发不该被这些噪音挡住——
 * 但挂在 0.0.0.0 上就必须说清楚哪几项还是默认值。
 */
function deployWarnings() {
  const out = [];
  const exposed = HOST !== '127.0.0.1' && HOST !== 'localhost';

  if (exposed && !TRUST_PROXY) {
    out.push('对外监听但没设 POND_TRUST_PROXY=1。如果前面有反向代理，所有访客会被算成同一个 IP，\n     限流会互相拖累（一个人刷快了，全站被挡）。如果没反代，可以忽略这条。');
  }
  if (exposed && process.env.POND_SECURE_COOKIE !== '1') {
    out.push('对外监听但没设 POND_SECURE_COOKIE=1。走 HTTPS 时务必打开，否则会话 Cookie 会跟着明文请求发出去。');
  }
  if (exposed && !process.env.POND_BASE_URL) {
    out.push('没设 POND_BASE_URL。canonical 和 sitemap 会从 Host 头推，搜索引擎可能收到不一致的网址。');
  }
  if (exposed && seedResult.seeded) {
    out.push(`示例数据里的 admin / ${DEMO_PASSWORD} 是公开密码，任何人都能登进去当管理员。\n     上线前用 node scripts/set-password.js admin 改掉，或者删掉 data/ 用 POND_NO_SEED=1 重来。`);
  }
  return out;
}

/**
 * 配置正确时的一句确认。不是警告——真警告见上。
 * 这里只提醒一件应用自己看不到、但必须成立的事：端口没对公网开着。
 */
function deployNote() {
  const exposed = HOST !== '127.0.0.1' && HOST !== 'localhost';
  if (!exposed || !TRUST_PROXY) return null;
  return `反代模式：已信任 X-Forwarded-For，${PORT} 端口不能对公网开放（否则可伪造来源 IP 绕过限流）。`;
}

function shutdown() {
  console.log('\n  正在关闭…');
  chat.closeAll();
  server.close(() => {
    try { db.close(); } catch { /* 忽略 */ }
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 2000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

module.exports = { server, config, shutdown };
