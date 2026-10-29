'use strict';

/**
 * Pond · API 测试
 * 跑法：npm test
 * 每个测试用独立临时数据库，跑完删除。
 */

const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const DB_FILE = path.join(os.tmpdir(), 'pond-test-' + process.pid + '.db');
process.env.POND_DB = DB_FILE;
process.env.POND_DATA_DIR = path.dirname(DB_FILE);
process.env.POND_HOST = '127.0.0.1';
// 测试依赖这批固定示例数据。站点配置改成自己的塘口后，seed 默认会跳过，
// 所以这里强制写入，保证 npm test 在任何 fork 里都能跑。
process.env.POND_SEED_FORCE = '1';

const { server } = require('../server.js');

let base = '';

/** 一个带 Cookie 罐的客户端 */
function session() {
  const jar = new Map();
  const call = async (method, p, body) => {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (jar.size) {
      headers.Cookie = Array.from(jar, ([k, v]) => k + '=' + v).join('; ');
    }
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
    cookieHeader: () => Array.from(jar, ([k, v]) => k + '=' + v).join('; ')
  };
}

test.before(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = 'http://127.0.0.1:' + server.address().port;
});

test.after(async () => {
  await new Promise((resolve) => {
    server.close(resolve);
    // fetch 的 keep-alive 连接会让 close 一直等，这里直接断掉
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
  });
  for (const f of [DB_FILE, DB_FILE + '-wal', DB_FILE + '-shm']) {
    try { fs.rmSync(f, { force: true }); } catch { /* 忽略 */ }
  }
});

test('bootstrap 返回配置、标签与统计', async () => {
  const s = session();
  const r = await s.get('/api/bootstrap');
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.ok(r.body.data.config.name);
  assert.ok(Array.isArray(r.body.data.tags));
  assert.ok(r.body.data.stats.posts > 0, '种子数据应该有帖子');
  assert.equal(r.body.data.me, null, '未登录时 me 应为 null');
});

test('帖子列表支持排序、标签与搜索', async () => {
  const s = session();
  const fat = await s.get('/api/posts?sort=fat&limit=5');
  assert.equal(fat.status, 200);
  assert.ok(fat.body.data.items.length > 0);
  assert.ok(fat.body.data.items.length <= 5);

  const byTag = await s.get('/api/posts?tag=' + encodeURIComponent('养鱼教程'));
  assert.ok(byTag.body.data.items.every((p) => p.tags.includes('养鱼教程')));

  const bySearch = await s.get('/api/posts?q=' + encodeURIComponent('红烧肉'));
  assert.ok(bySearch.body.data.items.length > 0, '搜「红烧肉」应该有结果');
});

test('未登录不能发帖、不能投喂', async () => {
  const s = session();
  const post = await s.post('/api/posts', { title: 'x', body: 'xx' });
  assert.equal(post.status, 401);
  assert.equal(post.body.error.code, 'unauthorized');

  const vote = await s.post('/api/vote', { targetType: 'post', targetId: 'whatever' });
  assert.equal(vote.status, 401);
});

test('注册后信任等级为 0，不能开楼但能回复', async () => {
  const s = session();
  const reg = await s.post('/api/auth/register', {
    username: 'newfish', password: 'pond1234', fishName: '新鱼', fishType: '咸鱼'
  });
  assert.equal(reg.status, 200);
  assert.equal(reg.body.data.me.trust, 0);

  const denied = await s.post('/api/posts', { title: '第一楼', body: '我想开楼' });
  assert.equal(denied.status, 403);
  assert.equal(denied.body.error.code, 'trust_too_low');

  // 回复不受信任等级限制
  const list = await s.get('/api/posts?limit=1');
  const pid = list.body.data.items[0].id;
  const floor = await s.post('/api/posts/' + pid + '/floors', { body: '新鱼来盖一楼' });
  assert.equal(floor.status, 200);
  assert.ok(floor.body.data.post.floors.length >= 1);
});

test('重复账号会被拒绝', async () => {
  const s = session();
  const reg = await s.post('/api/auth/register', { username: 'admin', password: 'pond1234' });
  assert.equal(reg.status, 409);
  assert.equal(reg.body.error.code, 'username_taken');
});

test('密码错误无法登录', async () => {
  const s = session();
  const r = await s.post('/api/auth/login', { username: 'admin', password: 'wrong-password' });
  assert.equal(r.status, 401);
  assert.equal(r.body.error.code, 'bad_credentials');
});

test('管理员可以开楼、盖楼、投喂、收藏、关注', async () => {
  const s = session();
  const login = await s.post('/api/auth/login', { username: 'admin', password: 'pond1234' });
  assert.equal(login.status, 200);
  assert.ok(login.body.data.me.trust >= 1);

  const created = await s.post('/api/posts', {
    title: '接口测试楼', body: '第一段\n\n第二段', quote: '本鲸今天不想上班', tags: ['求助']
  });
  assert.equal(created.status, 200);
  const pid = created.body.data.post.id;
  assert.deepEqual(created.body.data.post.tags, ['求助']);

  const floor = await s.post('/api/posts/' + pid + '/floors', { body: '二楼' });
  assert.equal(floor.status, 200);
  const fid = floor.body.data.post.floors[0].id;
  assert.equal(floor.body.data.post.floors[0].num, 2, '第一层回复应该是 2 楼');

  const reply = await s.post('/api/floors/' + fid + '/replies', { body: '楼中楼' });
  assert.equal(reply.status, 200);
  assert.equal(reply.body.data.post.floors[0].replies.length, 1);

  const v1 = await s.post('/api/vote', { targetType: 'post', targetId: pid });
  assert.equal(v1.body.data.voted, true);
  assert.equal(v1.body.data.count, 1);

  const v2 = await s.post('/api/vote', { targetType: 'post', targetId: pid });
  assert.equal(v2.body.data.voted, false);
  assert.equal(v2.body.data.count, 0, '再点一次应该取消投喂');

  const b1 = await s.post('/api/bookmark', { postId: pid });
  assert.equal(b1.body.data.bookmarked, true);
  const basket = await s.get('/api/basket');
  assert.ok(basket.body.data.items.some((p) => p.id === pid));

  const self = await s.post('/api/follow', { userId: login.body.data.me.id });
  assert.equal(self.status, 400, '不能关注自己');

  const detail = await s.get('/api/posts/' + pid);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.data.post.id, pid);
});

test('关注别人后对方会收到通知', async () => {
  const author = session();
  await author.post('/api/auth/login', { username: 'kaikai', password: 'pond1234' });
  const authorMe = await author.get('/api/me');
  const authorId = authorMe.body.data.me.id;

  const fan = session();
  await fan.post('/api/auth/login', { username: 'tangyuan', password: 'pond1234' });
  const f = await fan.post('/api/follow', { userId: authorId });
  assert.equal(f.body.data.following, true, 'tangyuan 原本没关注 kaikai');

  const notif = await author.get('/api/notifications');
  assert.ok(notif.body.data.items.length > 0, '被关注应该产生通知');
  assert.ok(notif.body.data.items.some((n) => n.type === 'follow'));
});

test('版主可以置顶，普通成员不行', async () => {
  const member = session();
  await member.post('/api/auth/login', { username: 'ali', password: 'pond1234' });
  const list = await member.get('/api/posts?limit=1');
  const pid = list.body.data.items[0].id;

  const denied = await member.post('/api/mod/post', { postId: pid, pinned: true });
  assert.equal(denied.status, 403);

  const mod = session();
  await mod.post('/api/auth/login', { username: 'zhouzhou', password: 'pond1234' });
  const okRes = await mod.post('/api/mod/post', { postId: pid, pinned: true });
  assert.equal(okRes.status, 200);

  const after = await mod.get('/api/posts?limit=1');
  assert.equal(after.body.data.items[0].pinned, true, '置顶帖应该排在最前');
});

test('不存在的资源返回 404', async () => {
  const s = session();
  const r = await s.get('/api/posts/p_not_exist');
  assert.equal(r.status, 404);
  assert.equal(r.body.error.code, 'not_found');
});

test('写接口要求 JSON 类型', async () => {
  const res = await fetch(base + '/api/vote', {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: 'x'
  });
  assert.equal(res.status, 415);
});

test('退出登录后身份失效', async () => {
  const s = session();
  await s.post('/api/auth/login', { username: 'kaikai', password: 'pond1234' });
  const before = await s.get('/api/me');
  assert.ok(before.body.data.me);

  await s.post('/api/auth/logout');
  const after = await s.get('/api/me');
  assert.equal(after.body.data.me, null);
});

/* ---------- 鱼汛 ---------- */

test('鱼汛：历史消息按时间正序返回', async () => {
  const s = session();
  const r = await s.get('/api/chat/messages?limit=100');
  assert.equal(r.status, 200);
  const items = r.body.data.items;
  assert.ok(items.length >= 10, '种子数据应该带了一批聊天记录');
  for (let i = 1; i < items.length; i++) {
    assert.ok(items[i].createdAt >= items[i - 1].createdAt, '应该按时间正序');
  }
  assert.ok(items[0].author.fishName, '每条消息都要带作者');
});

test('鱼汛：未登录不能发言', async () => {
  const s = session();
  const r = await s.post('/api/chat/messages', { body: '偷偷说一句' });
  assert.equal(r.status, 401);
  assert.equal(r.body.error.code, 'unauthorized');
});

test('鱼汛：登录后能发言，空消息被拒，超长被截断', async () => {
  const s = session();
  await s.post('/api/auth/login', { username: 'momo', password: 'pond1234' });

  const empty = await s.post('/api/chat/messages', { body: '   ' });
  assert.equal(empty.status, 400);

  const sent = await s.post('/api/chat/messages', { body: 'x'.repeat(700) });
  assert.equal(sent.status, 200);
  assert.equal(sent.body.data.message.body.length, 500, '超过 500 字要截断');
  assert.equal(sent.body.data.message.author.username, 'momo');

  const hist = await s.get('/api/chat/messages?limit=5');
  const ids = hist.body.data.items.map((m) => m.id);
  assert.ok(ids.includes(sent.body.data.message.id), '刚发的消息应该在最新一批里');
});

test('鱼汛：after 参数只返回之后的消息', async () => {
  const s = session();
  await s.post('/api/auth/login', { username: 'kaikai', password: 'pond1234' });
  const hist = await s.get('/api/chat/messages?limit=100');
  const items = hist.body.data.items;
  const pivot = items[items.length - 2].createdAt;

  const later = await s.get('/api/chat/messages?after=' + pivot);
  assert.ok(later.body.data.items.length <= 2);
  assert.ok(later.body.data.items.every((m) => m.createdAt > pivot));
});

test('鱼汛：只有版主能删消息', async () => {
  const author = session();
  await author.post('/api/auth/login', { username: 'tangyuan', password: 'pond1234' });
  const sent = await author.post('/api/chat/messages', { body: '这条等下会被删掉' });
  const mid = sent.body.data.message.id;

  const member = session();
  await member.post('/api/auth/login', { username: 'ali', password: 'pond1234' });
  const denied = await member.post('/api/mod/chat', { messageId: mid });
  assert.equal(denied.status, 403);

  const mod = session();
  await mod.post('/api/auth/login', { username: 'zhouzhou', password: 'pond1234' });
  const done = await mod.post('/api/mod/chat', { messageId: mid });
  assert.equal(done.status, 200);

  const hist = await mod.get('/api/chat/messages?limit=100');
  assert.ok(!hist.body.data.items.some((m) => m.id === mid), '删掉的消息不该再出现');
});

test('鱼汛：SSE 连上能收到 hello 和别人的消息', async () => {
  const readerSession = session();
  await readerSession.post('/api/auth/login', { username: 'qingning', password: 'pond1234' });

  const sender = session();
  await sender.post('/api/auth/login', { username: 'linshen', password: 'pond1234' });

  const ctrl = new AbortController();
  let reader = null;
  try {
    const res = await fetch(base + '/api/chat/stream', {
      headers: { Cookie: readerSession.cookieHeader() },
      signal: ctrl.signal
    });
    assert.equal(res.status, 200);
    assert.ok(
      (res.headers.get('content-type') || '').includes('text/event-stream'),
      'SSE 必须返回 text/event-stream'
    );

    reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';

    const waitFor = async (predicate, ms = 4000) => {
      const deadline = Date.now() + ms;
      while (Date.now() < deadline) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        if (predicate(buf)) return buf;
      }
      throw new Error('等不到期望的事件，已收到：' + buf.slice(0, 400));
    };

    await waitFor((s) => s.includes('event: hello'));
    assert.ok(buf.includes('qingning') || buf.includes('青柠气泡'), 'hello 里应该带自己的身份');

    // 连上之后 bootstrap 的在线人数应该至少是 1
    const boot = await readerSession.get('/api/bootstrap');
    assert.ok(boot.body.data.chat.count >= 1, '在线人数应该算上这条连接');

    await sender.post('/api/chat/messages', { body: 'SSE 链路测试消息' });
    await waitFor((s) => s.includes('SSE 链路测试消息'));
    assert.ok(buf.includes('event: msg'), '应该收到 msg 事件');
  } finally {
    ctrl.abort();
    if (reader) {
      try { await reader.cancel(); } catch { /* 已断开 */ }
    }
  }
});
