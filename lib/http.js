'use strict';

/**
 * Pond · HTTP 基础设施
 * 极简路由、JSON 收发、静态资源、内存限流。
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8'
};

class HttpError extends Error {
  constructor(status, code, message, extra) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

function sendJSON(res, status, payload, headers) {
  const body = JSON.stringify(payload);
  const buf = Buffer.from(body, 'utf8');
  res.writeHead(status, Object.assign({
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': buf.length,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  }, headers || {}));
  res.end(buf);
}

function ok(res, data, headers) {
  sendJSON(res, 200, { ok: true, data }, headers);
}

function fail(res, status, code, message, extra) {
  sendJSON(res, status, { ok: false, error: { code, message, ...(extra || {}) } });
}

const MAX_BODY = 256 * 1024;

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new HttpError(413, 'payload_too_large', '请求体太大了'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        const parsed = JSON.parse(raw);
        resolve(parsed && typeof parsed === 'object' ? parsed : {});
      } catch {
        reject(new HttpError(400, 'bad_json', '请求体不是合法 JSON'));
      }
    });
    req.on('error', reject);
  });
}

/**
 * 收原始字节。上传图片用——那边不收 JSON，直接把文件当请求体。
 * 上限由调用方给。
 *
 * 超限时不要 req.destroy()：连接一断，客户端拿到的是「网络错误」，
 * 用户只会看到「上传失败」，永远不知道是自己那张图太大。
 * 这里只 pause + reject，让调用方把 413 写出去，写完再由 server.js 关连接。
 */
function readRaw(req, max) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let over = false;
    const chunks = [];
    req.on('data', (c) => {
      if (over) return;
      size += c.length;
      if (size > max) {
        over = true;
        req.pause();
        reject(new HttpError(413, 'payload_too_large', `文件太大了，上限 ${Math.round(max / 1024 / 1024)}MB`));
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => { if (!over) resolve(Buffer.concat(chunks)); });
    req.on('error', (e) => { if (!over) reject(e); });
  });
}

/* ---------- 限流：滑动窗口 ---------- */

const buckets = new Map();

function rateLimit(key, limit, windowMs) {
  const t = Date.now();
  let b = buckets.get(key);
  if (!b || t - b.start > windowMs) {
    b = { start: t, count: 0 };
    buckets.set(key, b);
  }
  b.count += 1;
  if (b.count > limit) return false;
  return true;
}

setInterval(() => {
  const t = Date.now();
  for (const [k, b] of buckets) if (t - b.start > 10 * 60 * 1000) buckets.delete(k);
}, 5 * 60 * 1000).unref();

/* ---------- 静态资源 ---------- */

const etagCache = new Map();

function serveStatic(res, rootDir, urlPath) {
  let rel = decodeURIComponent(urlPath.split('?')[0]);
  if (rel === '/' || rel === '') rel = '/index.html';

  const filePath = path.normalize(path.join(rootDir, rel));
  if (!filePath.startsWith(path.normalize(rootDir))) {
    return fail(res, 403, 'forbidden', '路径不合法');
  }
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return false;
  }
  if (!stat.isFile()) return false;

  const ext = path.extname(filePath).toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';

  let etag = etagCache.get(filePath);
  if (!etag || etag.mtime !== stat.mtimeMs) {
    etag = { mtime: stat.mtimeMs, value: '"' + crypto.createHash('sha1').update(filePath + stat.mtimeMs + stat.size).digest('hex').slice(0, 16) + '"' };
    etagCache.set(filePath, etag);
  }

  const headers = {
    'Content-Type': type,
    'Content-Length': stat.size,
    'ETag': etag.value,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=60'
  };
  res.writeHead(200, headers);
  fs.createReadStream(filePath).pipe(res);
  return true;
}

module.exports = {
  HttpError,
  sendJSON,
  ok,
  fail,
  readBody,
  readRaw,
  rateLimit,
  serveStatic
};
