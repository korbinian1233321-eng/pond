'use strict';

/**
 * Pond · 图片上传测试
 * 跑法：npm test
 *
 * 重点不是「能传上去」，是「传不上来奇怪的东西」。
 * 所以一半用例在传坏文件：假 PNG、SVG、超大、路径穿越。
 */

const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const DB_FILE = path.join(os.tmpdir(), 'pond-upload-' + process.pid + '.db');
const DATA_DIR = path.join(os.tmpdir(), 'pond-upload-data-' + process.pid);
process.env.POND_DB = DB_FILE;
process.env.POND_DATA_DIR = DATA_DIR;
process.env.POND_HOST = '127.0.0.1';
process.env.POND_SEED_FORCE = '1';
// 图片默认是关的（pond.config.js 里 images: false）。这个文件测的是「打开之后」的行为，
// 「关着的时候」由 images-off.test.js 单独测。
process.env.POND_IMAGES = '1';

const { server } = require('../server.js');

const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);
const GIF_1x1 = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64'
);

let base = '';

function session() {
  const jar = new Map();
  const call = async (method, p, body, extraHeaders) => {
    const headers = Object.assign({}, extraHeaders || {});
    if (body !== undefined && !(body instanceof Buffer)) headers['Content-Type'] = 'application/json';
    if (jar.size) headers.Cookie = Array.from(jar, ([k, v]) => k + '=' + v).join('; ');
    const res = await fetch(base + p, {
      method,
      headers,
      body: body === undefined ? undefined : (body instanceof Buffer ? body : JSON.stringify(body))
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
    return { status: res.status, body: json, headers: res.headers };
  };
  return {
    get: (p) => call('GET', p),
    post: (p, b, h) => call('POST', p, b === undefined ? {} : b, h),
    del: (p) => call('DELETE', p, {}, { 'Content-Type': 'application/json' }),
    cookieHeader: () => Array.from(jar, ([k, v]) => k + '=' + v).join('; ')
  };
}

async function loggedIn(username) {
  const s = session();
  const r = await s.post('/api/auth/login', { username, password: 'pond1234' });
  assert.equal(r.status, 200, username + ' 登录失败');
  return s;
}

/** 直接发原始字节，模拟前端 fetch(file) */
function upload(s, buf, type) {
  return s.post('/api/upload', buf, { 'Content-Type': type || 'application/octet-stream' });
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
  try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch { /* 忽略 */ }
});

test('没登录不能传图', async () => {
  const r = await upload(session(), PNG_1x1, 'image/png');
  assert.equal(r.status, 401);
});

test('传一张 PNG，拿回 URL 和宽高', async () => {
  const s = await loggedIn('admin');
  const r = await upload(s, PNG_1x1, 'image/png');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const d = r.body.data;
  assert.match(d.url, /^\/uploads\/f_[a-z0-9]+\.png$/);
  assert.equal(d.width, 1);
  assert.equal(d.height, 1);
  assert.equal(d.bytes, PNG_1x1.length);
});

test('传一张 GIF 也能认出宽高', async () => {
  const s = await loggedIn('admin');
  const r = await upload(s, GIF_1x1, 'image/gif');
  assert.equal(r.status, 200);
  assert.match(r.body.data.url, /\.gif$/);
  assert.equal(r.body.data.width, 1);
});

test('存下来的图能取回来，带正确的类型和长缓存', async () => {
  const s = await loggedIn('admin');
  const up = await upload(s, PNG_1x1, 'image/png');
  const res = await fetch(base + up.body.data.url);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/png');
  assert.match(res.headers.get('cache-control') || '', /immutable/);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  const buf = Buffer.from(await res.arrayBuffer());
  assert.equal(buf.length, PNG_1x1.length);
});

test('把文本文件说成 PNG，按内容拒掉', async () => {
  const s = await loggedIn('admin');
  const fake = Buffer.from('<?php system($_GET["c"]); ?>'.repeat(10), 'utf8');
  const r = await upload(s, fake, 'image/png');
  assert.equal(r.status, 415, '只看 Content-Type 就放行了，这是漏洞');
  assert.equal(r.body.error.code, 'bad_type');
});

test('不收 SVG', async () => {
  const s = await loggedIn('admin');
  const svg = Buffer.from(
    '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    'utf8'
  );
  const r = await upload(s, svg, 'image/svg+xml');
  assert.equal(r.status, 415);
  assert.match(r.body.error.message, /SVG/);
});

test('超过 5MB 直接拒', async () => {
  const s = await loggedIn('admin');
  const big = Buffer.alloc(5 * 1024 * 1024 + 10);
  PNG_1x1.copy(big, 0);
  const r = await upload(s, big, 'image/png');
  assert.equal(r.status, 413);
});

test('文件名形状不对一律 404，不给路径穿越留口子', async () => {
  for (const p of [
    '/uploads/../data/pond.db',
    '/uploads/..%2f..%2fpond.db',
    '/uploads/index.html',
    '/uploads/f_abc.png.bak',
    '/uploads/'
  ]) {
    const res = await fetch(base + p);
    assert.equal(res.status, 404, p + ' 居然能取到东西');
  }
});

test('别人传的图删不掉，自己传的能删', async () => {
  const owner = await loggedIn('qingning');
  const up = await upload(owner, PNG_1x1, 'image/png');
  const id = up.body.data.id;
  const url = up.body.data.url;

  const other = await loggedIn('linshen');
  const denied = await other.del('/api/uploads/' + id);
  assert.equal(denied.status, 403);

  const ok = await owner.del('/api/uploads/' + id);
  assert.equal(ok.status, 200);

  const gone = await fetch(base + url);
  assert.equal(gone.status, 404, '数据库删了但文件还在磁盘上');
});

test('正文里的站内图渲染成 <img>，带宽高', async () => {
  const s = await loggedIn('admin');
  const up = await upload(s, PNG_1x1, 'image/png');
  const body = '看图\n\n![](' + up.body.data.url + ')\n\n就这样';

  const created = await s.post('/api/posts', { title: '带图的楼', body, tags: [] });
  assert.equal(created.status, 200, JSON.stringify(created.body));

  const html = await (await fetch(base + '/p/' + created.body.data.post.id)).text();
  assert.match(html, /<img class="post-img" src="\/uploads\/f_[a-z0-9]+\.png"/);
  assert.match(html, /width="1" height="1"/, '没带宽高，图加载时页面会跳');
});

test('外链图片不渲染成 <img>，只当普通文字', async () => {
  const s = await loggedIn('admin');
  const body = '![](https://example.com/track.png)';
  const created = await s.post('/api/posts', { title: '外链图', body, tags: [] });
  assert.equal(created.status, 200);

  const html = await (await fetch(base + '/p/' + created.body.data.post.id)).text();
  assert.ok(!/src="https:\/\/example\.com\/track\.png"/.test(html), '外链图被渲染了，读者 IP 会漏给第三方');
});

test('前端和服务端认图的规则必须一致', async () => {
  // 图片是两套渲染代码都要处理的：服务端给爬虫、前端给用户。
  // 两边正则一旦漂移，就会出现「爬虫看得见、用户看不见」这种最难查的 bug。
  const fsx = require('node:fs');
  const pathx = require('node:path');
  const grab = (file) => {
    const src = fsx.readFileSync(pathx.join(__dirname, '..', file), 'utf8');
    const m = src.match(/IMG_RE = (\/.*?\/g)/);
    assert.ok(m, file + ' 里找不到 IMG_RE');
    return m[1];
  };
  assert.equal(grab('public/app.js'), grab('lib/render.js'));
});
