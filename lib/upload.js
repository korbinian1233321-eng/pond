'use strict';

/**
 * 图片上传。
 *
 * 没有 npm 依赖，所以既不用 multer 也不用 sharp，全靠内置模块：
 * 前端直接把文件当请求体 POST 过来（不是 multipart），服务端按魔数认格式、
 * 从文件头里读宽高，写进 data/uploads/。
 *
 * 三条底线：
 *   1. 只信文件头，不信 Content-Type，也不信扩展名——那两个都是客户端说了算的
 *   2. 不收 SVG。SVG 是 XML，能带 <script>，同源托管等于给自己开一个 XSS 后门
 *   3. 文件名由服务端生成，用户传什么都不影响落盘路径
 */

const fs = require('node:fs');
const path = require('node:path');
const { db, uid, now, DATA_DIR } = require('./db');

const MAX_BYTES = 5 * 1024 * 1024;
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const PER_USER_FILES = 300;

/** 认得的格式。ext 用于落盘和 URL，mime 用于响应头。 */
const KINDS = {
  png: { mime: 'image/png', ext: 'png' },
  jpg: { mime: 'image/jpeg', ext: 'jpg' },
  gif: { mime: 'image/gif', ext: 'gif' },
  webp: { mime: 'image/webp', ext: 'webp' }
};

/** 文件名的合法形状。URL 里只接受这个，别的一律 404。 */
const NAME_RE = /^f_[a-z0-9]+\.(png|jpg|gif|webp)$/;

function ensureDir() {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

/**
 * 按魔数判断格式。返回 'png' / 'jpg' / 'gif' / 'webp'，认不出返回 null。
 * 顺带认一下 SVG 和 PDF 这些「看起来像图片」的东西，好给出更准的错误提示。
 */
function sniff(buf) {
  if (!buf || buf.length < 12) return null;

  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
      buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a) return 'png';

  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';

  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return 'gif';

  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
      buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return 'webp';

  return null;
}

/** 认出来了但不收的格式，用来把错误提示说得具体一点 */
function sniffRejected(buf) {
  if (!buf || buf.length < 5) return null;
  const head = buf.slice(0, 512).toString('utf8').trim().toLowerCase();
  if (head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'))) return 'svg';
  if (buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) return 'pdf';
  return null;
}

/** 从文件头读宽高。读不出来返回 null——不影响上传，只是前端少两个属性。 */
function dimensions(buf, kind) {
  try {
    if (kind === 'png') {
      // IHDR 紧跟在 8 字节签名 + 4 字节长度 + 4 字节类型之后
      return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    }
    if (kind === 'gif') {
      return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
    }
    if (kind === 'jpg') {
      // 顺着段走，找到 SOFn（FFC0..FFCF，跳过 C4 DHT / C8 JPG / CC DAC）
      let i = 2;
      while (i + 9 < buf.length) {
        if (buf[i] !== 0xff) { i += 1; continue; }
        const marker = buf[i + 1];
        if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
        const len = buf.readUInt16BE(i + 2);
        const isSOF = marker >= 0xc0 && marker <= 0xcf &&
          marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
        if (isSOF) {
          return { width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5) };
        }
        i += 2 + len;
      }
      return null;
    }
    if (kind === 'webp') {
      const chunk = buf.slice(12, 16).toString('latin1');
      if (chunk === 'VP8X') {
        return {
          width: 1 + buf.readUIntLE(24, 3),
          height: 1 + buf.readUIntLE(27, 3)
        };
      }
      if (chunk === 'VP8 ') {
        return {
          width: buf.readUInt16LE(26) & 0x3fff,
          height: buf.readUInt16LE(28) & 0x3fff
        };
      }
      if (chunk === 'VP8L') {
        const b = buf.readUInt32LE(21);
        return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 };
      }
      return null;
    }
  } catch {
    return null;
  }
  return null;
}

/** 这个用户已经占了多少张 */
function countOf(userId) {
  return db.prepare('SELECT COUNT(*) AS n FROM uploads WHERE user_id = ?').get(userId).n;
}

/**
 * 存一张图。buf 是原始字节。
 * 返回 { id, url, width, height, bytes }，失败抛带 code 的 Error。
 */
function save(userId, buf) {
  if (!buf || !buf.length) {
    const e = new Error('没有收到文件');
    e.code = 'empty';
    throw e;
  }
  if (buf.length > MAX_BYTES) {
    const e = new Error('图片太大了，上限 5MB');
    e.code = 'too_large';
    throw e;
  }

  const kind = sniff(buf);
  if (!kind) {
    const rejected = sniffRejected(buf);
    const e = new Error(rejected === 'svg'
      ? '不收 SVG。SVG 能带脚本，托管同源图片等于给自己开后门，转成 PNG 再传吧'
      : rejected === 'pdf'
        ? '不收 PDF，只收 PNG / JPG / GIF / WebP'
        : '这不像一张图片。支持 PNG / JPG / GIF / WebP');
    e.code = 'bad_type';
    throw e;
  }

  if (countOf(userId) >= PER_USER_FILES) {
    const e = new Error(`一个人最多存 ${PER_USER_FILES} 张图，先删几张旧的`);
    e.code = 'quota';
    throw e;
  }

  const { mime, ext } = KINDS[kind];
  const id = uid('f');
  const name = id + '.' + ext;

  ensureDir();
  fs.writeFileSync(path.join(UPLOAD_DIR, name), buf);

  const dim = dimensions(buf, kind);
  db.prepare(
    'INSERT INTO uploads (id, user_id, ext, mime, bytes, width, height, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(id, userId, ext, mime, buf.length, dim ? dim.width : null, dim ? dim.height : null, now());

  return {
    id,
    url: '/uploads/' + name,
    width: dim ? dim.width : null,
    height: dim ? dim.height : null,
    bytes: buf.length
  };
}

/** URL 里那段文件名 → 磁盘路径。形状不对就返回 null，不给路径穿越留口子。 */
function pathOf(name) {
  if (!NAME_RE.test(name)) return null;
  return path.join(UPLOAD_DIR, name);
}

/** 删一张。只有上传者本人和版主能删。返回 true 表示删掉了。 */
function remove(userId, id, isMod) {
  const row = db.prepare('SELECT id, user_id, ext FROM uploads WHERE id = ?').get(id);
  if (!row) return false;
  if (!isMod && row.user_id !== userId) {
    const e = new Error('这不是你传的图');
    e.code = 'forbidden';
    throw e;
  }
  db.prepare('DELETE FROM uploads WHERE id = ?').run(id);
  try {
    fs.rmSync(path.join(UPLOAD_DIR, row.id + '.' + row.ext), { force: true });
  } catch { /* 文件可能已经不在了，不影响 */ }
  return true;
}

module.exports = {
  MAX_BYTES,
  PER_USER_FILES,
  UPLOAD_DIR,
  KINDS,
  sniff,
  sniffRejected,
  dimensions,
  save,
  remove,
  pathOf,
  countOf
};
