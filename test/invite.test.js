'use strict';

/**
 * Pond · 邀请制注册测试
 *
 * 这里测的不是「码能不能生成」，而是几条边界：
 *   - 没码、错码、过期码、用过的码，都进不来
 *   - 有效码进来的人，信任等级直接是 1（不用干等 24 小时）
 *   - 配额到顶就发不出新码，但站长和版主不受限
 *   - 别人的码撤不掉，用过的码撤不回
 */

const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const DB_FILE = path.join(os.tmpdir(), 'pond-invite-' + process.pid + '.db');
process.env.POND_DB = DB_FILE;
process.env.POND_DATA_DIR = path.dirname(DB_FILE);
process.env.POND_HOST = '127.0.0.1';
process.env.POND_SEED_FORCE = '1';
process.env.POND_REGISTRATION = 'invite';
// 别让 POND_ADMIN 撞上测试用的账号名，否则绕过邀请码会污染结果
delete process.env.POND_ADMIN;

const { server } = require('../server.js');
const { db } = require('../lib/db');
const invite = require('../lib/invite');

let base = '';

function session() {
  const jar = new Map();
  const call = async (method, p, body) => {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (jar.size) headers.Cookie = Array.from(jar, ([k, v]) => k + '=' + v).join('; ');
    const res = await fetch(base + p, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    for (const raw of res.headers.getSetCookie()) {
      const pair = raw.split(';')[0];
      const i = pair.indexOf('=');
      const k = pair.slice(0, i);
      const v = pair.slice(i + 1);
      if (!v) jar.delete(k);
      else jar.set(k, v);
    }
    const json = await res.json().catch(() => null);
    return { status: res.status, body: json };
  };
  return {
    get: (p) => call('GET', p),
    post: (p, body) => call('POST', p, body === undefined ? {} : body),
    // 写接口要求 Content-Type: application/json（防 CSRF），DELETE 也得带上
    del: (p) => call('DELETE', p, {})
  };
}

/** 造一个码。fake 用户不需要真的存在，create 只读 id 和 role。 */
function mint(overrides) {
  const made = invite.create({ id: 'system', role: 'admin' }, overrides || '');
  assert.ok(made, '造码应该成功');
  return made;
}

function reg(s, username, extra) {
  return s.post('/api/auth/register', {
    username,
    password: 'correct-horse-8',
    ...extra
  });
}

test.before(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = 'http://127.0.0.1:' + server.address().port;
});

test.after(async () => {
  await new Promise((resolve) => {
    server.close(resolve);
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
  });
  for (const f of [DB_FILE, DB_FILE + '-wal', DB_FILE + '-shm']) {
    try { fs.rmSync(f, { force: true }); } catch { /* 忽略 */ }
  }
});

test('不给邀请码进不来', async () => {
  const s = session();
  const r = await reg(s, 'noinvite');
  assert.equal(r.status, 403);
  assert.equal(r.body.error.code, 'invite_required');
});

test('码不对进不来', async () => {
  const s = session();
  const r = await reg(s, 'wrongcode', { invite: 'ZZZZ-ZZZZ' });
  assert.equal(r.status, 403);
  assert.equal(r.body.error.code, 'invite_invalid');

  // 位数都不对的，给一句更具体的提示
  const short = await reg(s, 'shortcode', { invite: 'ABC' });
  assert.equal(short.status, 403);
  assert.match(short.body.error.message, /8 位/);
});

test('过期的码进不来', async () => {
  const made = mint('过期测试');
  db.prepare('UPDATE invites SET expires_at = ? WHERE id = ?').run(Date.now() - 1000, made.id);

  const s = session();
  const r = await reg(s, 'expiredcode', { invite: made.code });
  assert.equal(r.status, 403);
  assert.equal(r.body.error.code, 'invite_invalid');
});

test('有效的码能进，而且信任等级直接是 1', async () => {
  const made = mint('给新人');
  const s = session();
  const r = await reg(s, 'invited_one', { invite: made.code });

  assert.equal(r.status, 200);
  assert.equal(r.body.data.me.username, 'invited_one');
  assert.equal(r.body.data.me.trust, 1, '被邀请的人不用干等 24 小时');

  // 码上记了谁用了它，用户上记了谁带他进来
  const row = db.prepare('SELECT invited_by, created_at FROM users WHERE username = ?').get('invited_one');
  assert.equal(row.invited_by, 'system');
  const used = db.prepare('SELECT used_by, used_at FROM invites WHERE id = ?').get(made.id);
  assert.ok(used.used_by, '码应该被标记为已使用');
  assert.ok(used.used_at > 0);
});

test('同一个码不能用第二次', async () => {
  const made = mint('只能用一次');
  const first = await reg(session(), 'reuse_a', { invite: made.code });
  assert.equal(first.status, 200);

  const second = await reg(session(), 'reuse_b', { invite: made.code });
  assert.equal(second.status, 403);
  assert.equal(second.body.error.code, 'invite_invalid');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users WHERE username = ?').get('reuse_b').n, 0,
    '被拒的人不该留下半个账号');
});

test('大小写、空格、横线都不影响识别', async () => {
  const made = mint('手抄友好');
  // 用户抄的时候小写了、还多打了空格
  const messy = ' ' + made.code.toLowerCase().replace('-', ' ') + ' ';
  const r = await reg(session(), 'messy_code', { invite: messy });
  assert.equal(r.status, 200, 'normalize 应该把这些差异抹平');
});

test('注册失败时码不会被吃掉', async () => {
  const made = mint('密码太短');
  const s = session();
  // 密码不合格，走不到占码那一步
  const r = await s.post('/api/auth/register', { username: 'weakpass', password: '123', invite: made.code });
  assert.equal(r.status, 400);
  assert.equal(r.body.error.code, 'weak_password');

  const still = db.prepare('SELECT used_by FROM invites WHERE id = ?').get(made.id);
  assert.equal(still.used_by, null, '码应该还是可用的');
});

test('邀请面板：发码、看码、撤销', async () => {
  const made = mint('面板测试');
  const s = session();
  const login = await reg(s, 'panel_user', { invite: made.code });
  assert.equal(login.status, 200);

  const created = await s.post('/api/invites', { note: '给阿金' });
  assert.equal(created.status, 200);
  assert.match(created.body.data.invite.code, /^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  assert.equal(created.body.data.invite.note, '给阿金');

  const list = await s.get('/api/invites');
  assert.equal(list.status, 200);
  assert.equal(list.body.data.enabled, true);
  assert.equal(list.body.data.items.length, 1);
  assert.equal(list.body.data.items[0].available, true);

  const gone = await s.del('/api/invites/' + created.body.data.invite.id);
  assert.equal(gone.status, 200);

  const after = await s.get('/api/invites');
  assert.equal(after.body.data.items.length, 0);
});

test('配额：普通用户同时最多 3 个，发满就拦住', async () => {
  const made = mint('配额');
  const s = session();
  await reg(s, 'quota_user', { invite: made.code });

  const codes = [];
  for (let i = 0; i < 3; i++) {
    const r = await s.post('/api/invites', {});
    assert.equal(r.status, 200, `第 ${i + 1} 个应该成功`);
    codes.push(r.body.data.invite);
  }

  const fourth = await s.post('/api/invites', {});
  assert.equal(fourth.status, 403);
  assert.equal(fourth.body.error.code, 'quota_full');

  const info = await s.get('/api/invites');
  assert.equal(info.body.data.quotaLeft, 0);

  // 用掉一个之后又能发了
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get('quota_user');
  invite.claim(codes[0].code, 'someone-else');
  const fifth = await s.post('/api/invites', {});
  assert.equal(fifth.status, 200, '手上的码被用掉一个，名额应该腾出来');
  assert.ok(user);
});

test('别人的码撤不掉，用过的码也撤不回', async () => {
  const a = mint('甲');
  const b = mint('乙');
  const sa = session();
  const sb = session();
  await reg(sa, 'owner_a', { invite: a.code });
  await reg(sb, 'owner_b', { invite: b.code });

  const mine = await sa.post('/api/invites', { note: '甲的码' });
  assert.equal(mine.status, 200);
  const id = mine.body.data.invite.id;

  const stolen = await sb.del('/api/invites/' + id);
  assert.equal(stolen.status, 403);
  assert.equal(stolen.body.error.code, 'forbidden');

  // 被用掉的码撤不回来
  db.prepare('UPDATE invites SET used_by = ?, used_at = ? WHERE id = ?').run('x', Date.now(), id);
  const used = await sa.del('/api/invites/' + id);
  assert.equal(used.status, 403);
  assert.equal(used.body.error.code, 'used');
});

test('未登录看不到邀请面板', async () => {
  const s = session();
  const r = await s.get('/api/invites');
  assert.equal(r.status, 401);
});

test('码不含容易认错的字符', async () => {
  for (let i = 0; i < 40; i++) {
    const made = mint('字符集');
    const raw = made.code.replace('-', '');
    assert.equal(raw.length, 8);
    assert.doesNotMatch(raw, /[ILO01]/, '不该出现 I / L / O / 0 / 1：' + made.code);
    invite.revoke({ id: 'system', role: 'admin' }, made.id);
  }
});
