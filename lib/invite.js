'use strict';

/**
 * 邀请码。
 *
 * 一个塘刚开的时候最怕的不是没人来，是来了一堆机器人。邀请制的意思是：
 * 每个能进来的人，都是里面某个人带进来的——这既是门槛，也是追溯线索。
 *
 * 几条刻意的设计：
 *   - 一次性。用过就废，不给「一个码传遍全网」留机会
 *   - 有有效期。默认 14 天，没人用的码会自己作废
 *   - 有配额。默认每人同时最多 3 个未使用的码，用完再要。鼓励传播，不鼓励囤积
 *   - 站长和版主不受配额限制——不然社区刚起步时没人有码可用
 */

const crypto = require('node:crypto');
const { db, uid, now } = require('./db');

// 去掉了 I / L / O / 0 / 1：这几个字符在截图和手抄时最容易认错
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LEN = 8;

const DEFAULT_TTL_DAYS = 14;
const DEFAULT_QUOTA = 3;

const settings = {
  ttlMs: DEFAULT_TTL_DAYS * 24 * 60 * 60 * 1000,
  quota: DEFAULT_QUOTA
};

function configure(cfg) {
  if (!cfg) return;
  const days = Number(cfg.ttlDays);
  const quota = Number(cfg.quota);
  if (Number.isFinite(days) && days > 0) settings.ttlMs = days * 24 * 60 * 60 * 1000;
  if (Number.isFinite(quota) && quota >= 0) settings.quota = quota;
}

/** 生成 ABCD-EFGH 形状的码。用 randomInt 而不是 Math.random——这个要不可猜。 */
function newCode() {
  let raw = '';
  for (let i = 0; i < CODE_LEN; i++) {
    raw += ALPHABET[crypto.randomInt(ALPHABET.length)];
  }
  return raw.slice(0, 4) + '-' + raw.slice(4);
}

/** 用户可能带空格、小写、没有横线。统一成大写无分隔再查。 */
function normalize(code) {
  return String(code == null ? '' : code)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

/** 反过来：存的是 ABCD1234，给人看的是 ABCD-1234。抄的时候断一下不容易串行。 */
function display(code) {
  const c = normalize(code);
  return c.length === 8 ? c.slice(0, 4) + '-' + c.slice(4) : c;
}

function isPrivileged(user) {
  return !!user && (user.role === 'admin' || user.role === 'mod');
}

/** 这个人手上还有几个没用出去的码 */
function activeCount(userId) {
  return db.prepare(
    'SELECT COUNT(*) AS n FROM invites WHERE created_by = ? AND used_by IS NULL AND expires_at > ?'
  ).get(userId, now()).n;
}

function quotaLeft(user) {
  if (isPrivileged(user)) return Infinity;
  return Math.max(0, settings.quota - activeCount(user.id));
}

/**
 * 造一个码。配额满了返回 null，由调用方决定怎么提示。
 */
function create(user, note) {
  if (quotaLeft(user) <= 0) return null;

  const id = uid('iv');
  const code = newCode();
  const t = now();

  db.prepare(
    'INSERT INTO invites (id, code, created_by, note, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, normalize(code), user.id, String(note || '').slice(0, 40), t, t + settings.ttlMs);

  return view(db.prepare('SELECT * FROM invites WHERE id = ?').get(id));
}

/** 找一个还能用的码（存在、没用过、没过期） */
function findUsable(code) {
  const c = normalize(code);
  if (c.length !== CODE_LEN) return null;
  const row = db.prepare(
    'SELECT * FROM invites WHERE code = ? AND used_by IS NULL AND expires_at > ?'
  ).get(c, now());
  return row || null;
}

/**
 * 占住一个码。用条件 UPDATE 而不是先查后写——两个人同时拿同一个码注册时，
 * 只有一个能拿到 changes = 1，另一个会被挡在门外。
 */
function claim(code, userId) {
  const c = normalize(code);
  const changed = db.prepare(
    'UPDATE invites SET used_by = ?, used_at = ? WHERE code = ? AND used_by IS NULL AND expires_at > ?'
  ).run(userId, now(), c, now()).changes;
  return changed === 1;
}

/** 注册失败时把码还回去，不然这个人白丢一个名额 */
function release(code) {
  db.prepare('UPDATE invites SET used_by = NULL, used_at = NULL WHERE code = ?').run(normalize(code));
}

function listOf(userId) {
  return db.prepare(
    'SELECT * FROM invites WHERE created_by = ? ORDER BY created_at DESC LIMIT 50'
  ).all(userId).map(view);
}

/** 撤销一个还没用的码。只能撤自己的，版主可以撤任何人的。 */
function revoke(user, id) {
  const row = db.prepare('SELECT * FROM invites WHERE id = ?').get(id);
  if (!row) return { ok: false, reason: 'not_found' };
  if (row.used_by) return { ok: false, reason: 'used' };
  if (!isPrivileged(user) && row.created_by !== user.id) return { ok: false, reason: 'forbidden' };
  db.prepare('DELETE FROM invites WHERE id = ?').run(id);
  return { ok: true };
}

function view(row) {
  if (!row) return null;
  const t = now();
  return {
    id: row.id,
    code: display(row.code),
    note: row.note,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    usedAt: row.used_at || null,
    expired: !row.used_at && row.expires_at <= t,
    available: !row.used_at && row.expires_at > t
  };
}

module.exports = {
  configure,
  create,
  findUsable,
  claim,
  release,
  listOf,
  revoke,
  quotaLeft,
  activeCount,
  normalize,
  display,
  settings
};
