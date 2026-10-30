'use strict';

/**
 * Pond · 鉴权
 * scrypt 口令哈希 + 数据库会话 + HttpOnly Cookie。
 * 不引入任何第三方依赖。
 */

const crypto = require('node:crypto');
const { db, uid, now } = require('./db');

const SESSION_TTL = 1000 * 60 * 60 * 24 * 30; // 30 天
const COOKIE_NAME = 'pond_sid';
const SCRYPT_KEYLEN = 64;

/* ---------- 口令 ---------- */

function hashPassword(password, salt) {
  const s = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, s, SCRYPT_KEYLEN).toString('hex');
  return { hash, salt: s };
}

function verifyPassword(password, stored) {
  try {
    const { hash } = hashPassword(password, stored.pass_salt);
    const a = Buffer.from(hash, 'hex');
    const b = Buffer.from(stored.pass_hash, 'hex');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/* ---------- 会话 ---------- */

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const t = now();
  db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .run(token, userId, t, t + SESSION_TTL);
  return { token, expiresAt: t + SESSION_TTL };
}

function destroySession(token) {
  if (!token) return;
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

function userBySession(token) {
  if (!token) return null;
  const row = db.prepare(
    `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token = ? AND s.expires_at > ?`
  ).get(token, now());
  return row || null;
}

function purgeExpiredSessions() {
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now());
}

/* ---------- Cookie ---------- */

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  header.split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i < 0) return;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  });
  return out;
}

function sessionCookie(token, maxAgeSec) {
  const bits = [
    `${COOKIE_NAME}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSec}`
  ];
  if (process.env.POND_SECURE_COOKIE === '1') bits.push('Secure');
  return bits.join('; ');
}

function clearCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

/* ---------- 信任等级 ---------- */

const TRUST_RULES = {
  /** 注册满 24 小时，或已回复过 3 次，才能开新楼 */
  postMinAge: 1000 * 60 * 60 * 24,
  postMinReplies: 3,
  /** 被邀请进来的人不用等——邀请本身就是背书 */
  inviteSkipsWait: true
};

/**
 * 由 pond.config.js 的 trust 段驱动。
 * 在这里改而不是在 trustOf 里读配置，是为了让 trustOf 保持同步、不依赖请求上下文。
 */
function configureTrust(cfg) {
  if (!cfg) return;
  const hours = Number(cfg.postMinAgeHours);
  const replies = Number(cfg.postMinReplies);
  if (Number.isFinite(hours) && hours >= 0) TRUST_RULES.postMinAge = hours * 60 * 60 * 1000;
  if (Number.isFinite(replies) && replies >= 0) TRUST_RULES.postMinReplies = replies;
  if (typeof cfg.inviteSkipsWait === 'boolean') TRUST_RULES.inviteSkipsWait = cfg.inviteSkipsWait;
}

/**
 * 0 = 新鱼（只能回复、投喂）
 * 1 = 可开楼
 * 2 = 版主（可置顶/锁定/删除）
 */
function trustOf(user) {
  if (!user) return 0;
  if (user.role === 'mod' || user.role === 'admin') return 2;
  const replies = db.prepare('SELECT COUNT(*) AS n FROM floors WHERE author_id = ? AND deleted = 0')
    .get(user.id).n;
  if (replies >= TRUST_RULES.postMinReplies) return 1;
  // 有人拿自己的邀请码把你带进来，等于替你担保了，不用再等 24 小时。
  // 否则邀请来的人第一天只能回复，体验很怪。
  if (TRUST_RULES.inviteSkipsWait && user.invited_by) return 1;
  if (now() - user.created_at >= TRUST_RULES.postMinAge) return 1;
  return 0;
}

function canPost(user) {
  return trustOf(user) >= 1;
}

/* ---------- 输出给前端的用户视图 ---------- */

function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    fishName: row.fish_name,
    fishType: row.fish_type,
    bio: row.bio,
    role: row.role,
    trust: trustOf(row),
    createdAt: row.created_at
  };
}

module.exports = {
  COOKIE_NAME,
  hashPassword,
  verifyPassword,
  createSession,
  destroySession,
  userBySession,
  purgeExpiredSessions,
  parseCookies,
  sessionCookie,
  clearCookie,
  trustOf,
  canPost,
  configureTrust,
  publicUser,
  SESSION_TTL
};
