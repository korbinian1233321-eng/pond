'use strict';

/**
 * Pond · 服务端渲染测试
 * 跑法：npm test
 *
 * 盯的就一件事：爬虫不带 JS 来，能不能看见内容。
 * 所以这里不解析 DOM、不跑前端，直接对原始 HTML 做字符串断言。
 */

const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const DB_FILE = path.join(os.tmpdir(), 'pond-seo-test-' + process.pid + '.db');
process.env.POND_DB = DB_FILE;
process.env.POND_DATA_DIR = path.dirname(DB_FILE);
process.env.POND_HOST = '127.0.0.1';
process.env.POND_SEED_FORCE = '1';
delete process.env.POND_BASE_URL;

const { server } = require('../server.js');
const { DEMO_PASSWORD } = require('../lib/seed');

let base = '';

/** 带 Cookie 罐的客户端 */
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
    return res;
  };
  return { call, jar };
}

/** 直接取 HTML 文本 */
async function html(p) {
  const res = await fetch(base + p);
  return { status: res.status, headers: res.headers, text: await res.text() };
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

test('首页把楼列表直接写进 HTML', async () => {
  const r = await html('/');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /text\/html/);
  assert.equal(r.headers.get('x-robots-tag'), 'index, follow');

  assert.match(r.text, /<title>[^<]*大肥鱼塘[^<]*<\/title>/);
  assert.match(r.text, /<link rel="canonical" href="http:\/\/127\.0\.0\.1:\d+\/" \/>/);

  // 楼是真链接，不是 <button>
  assert.match(r.text, /<a class="thread[^"]*" href="\/p\/[\w-]+"/);
  assert.ok((r.text.match(/href="\/p\//g) || []).length >= 3, '首页至少要链出三层楼');
  // 塘口链接让爬虫能爬到标签页
  assert.ok((r.text.match(/href="\/t\//g) || []).length >= 3, '侧栏应该有塘口链接');

  // 正文真的在 HTML 里，不是等 JS 去取
  assert.match(r.text, /最近开的楼/);
  assert.match(r.text, /class="pond-desc"/);
  // JSON-LD
  assert.match(r.text, /application\/ld\+json/);
});

test('楼层页带上标题、摘要、正文与结构化数据', async () => {
  const list = await fetch(base + '/api/posts?limit=1').then((r) => r.json());
  const post = list.data.items[0];

  const r = await html('/p/' + post.id);
  assert.equal(r.status, 200);

  assert.ok(r.text.includes(post.title), '标题要出现在 HTML 里');
  assert.match(r.text, /<h1 class="post-h1">/);
  assert.match(r.text, /<meta name="description" content="[^"]{10,}"/);
  assert.match(r.text, /<meta property="og:type" content="article" \/>/);
  assert.match(r.text, /"@type":"DiscussionForumPosting"/);

  // 楼层正文和作者链接
  assert.match(r.text, /class="floor-body"/);
  assert.match(r.text, /href="\/u\/[\w-]+"/);
  assert.match(r.text, /href="\/t\/[^"]+"/);

  // 摘要里不该留 markdown 标记
  const desc = r.text.match(/<meta name="description" content="([^"]*)"/)[1];
  assert.ok(!desc.includes('**'), '摘要里不该有 ** 标记');
});

test('塘口页和鱼档页各自可访问', async () => {
  const list = await fetch(base + '/api/posts?limit=1').then((r) => r.json());
  const post = list.data.items[0];

  const tag = await html('/t/' + encodeURIComponent(post.tags[0]));
  assert.equal(tag.status, 200);
  assert.match(tag.text, /<h1>塘口「/);
  assert.ok(tag.text.includes(post.title), '塘口页应该列出这个标签下的楼');

  const user = await html('/u/' + post.author.id);
  assert.equal(user.status, 200);
  assert.match(user.text, /<div class="profile-name">/);
  assert.ok(user.text.includes(post.author.fishName));

  const nf = await html('/u/u_does_not_exist');
  assert.equal(nf.status, 404);
});

test('不存在的楼返回 404 而不是 200', async () => {
  const r = await html('/p/p_nope');
  assert.equal(r.status, 404);
  assert.match(r.headers.get('x-robots-tag'), /noindex/);
  assert.match(r.text, /这层楼不在了/);
  // 404 页也得有导航，不然人就卡死了
  assert.match(r.text, /href="\/"/);
});

test('sitemap 和 robots 指向真实的网址', async () => {
  const sm = await fetch(base + '/sitemap.xml');
  assert.equal(sm.status, 200);
  assert.match(sm.headers.get('content-type'), /xml/);
  const xml = await sm.text();
  assert.match(xml, /^<\?xml version="1.0" encoding="UTF-8"\?>/);
  assert.match(xml, /<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
  assert.match(xml, /<loc>http:\/\/127\.0\.0\.1:\d+\/<\/loc>/);
  assert.match(xml, /<loc>http:\/\/127\.0\.0\.1:\d+\/p\/[\w-]+<\/loc>/);
  assert.match(xml, /<loc>http:\/\/127\.0\.0\.1:\d+\/u\/[\w-]+<\/loc>/);

  const rb = await fetch(base + '/robots.txt');
  assert.equal(rb.status, 200);
  const txt = await rb.text();
  assert.match(txt, /^User-agent: \*$/m);
  assert.match(txt, /^Disallow: \/api\/$/m);
  assert.match(txt, /^Sitemap: http:\/\/127\.0\.0\.1:\d+\/sitemap\.xml$/m);
});

test('用户内容里的 HTML 会被转义，不会注入', async () => {
  const s = session();
  const login = await s.call('POST', '/api/auth/login', { username: 'admin', password: DEMO_PASSWORD });
  assert.equal(login.status, 200);

  const payload = '<script>alert("xss")</script> **粗** `代码`';
  const made = await s.call('POST', '/api/posts', {
    title: '注入测试 <img src=x onerror=alert(1)>',
    body: payload
  });
  assert.equal(made.status, 200);
  const postId = (await made.json()).data.post.id;

  const r = await html('/p/' + postId);
  assert.equal(r.status, 200);

  // 标签被转义成实体，浏览器不会执行
  assert.ok(!r.text.includes('<script>alert'), '正文里的 <script> 不能原样输出');
  assert.ok(!r.text.includes('<img src=x'), '标题里的 <img> 不能原样输出');
  assert.match(r.text, /&lt;script&gt;alert/);
  assert.match(r.text, /&lt;img src=x/);

  // 转义之后 markdown 还是要生效的
  assert.match(r.text, /<strong>粗<\/strong>/);
  assert.match(r.text, /<span class="code">代码<\/span>/);
});

test('接口和必须登录的页面不受影响', async () => {
  const api = await fetch(base + '/api/bootstrap');
  assert.equal(api.status, 200);
  assert.match(api.headers.get('content-type'), /application\/json/);

  // /chat 这些没有 SEO 价值，还是走单页外壳
  const chat = await html('/chat');
  assert.equal(chat.status, 200);
  assert.match(chat.text, /id="main"/);

  // 静态资源照旧
  const css = await fetch(base + '/styles.css');
  assert.equal(css.status, 200);
  assert.match(css.headers.get('content-type'), /text\/css/);
});

test('POND_BASE_URL 能盖掉 canonical 的域名', async () => {
  process.env.POND_BASE_URL = 'https://yu.example.com';
  try {
    const r = await html('/');
    assert.match(r.text, /<link rel="canonical" href="https:\/\/yu\.example\.com\/" \/>/);

    const sm = await fetch(base + '/sitemap.xml').then((x) => x.text());
    assert.match(sm, /<loc>https:\/\/yu\.example\.com\/<\/loc>/);

    const rb = await fetch(base + '/robots.txt').then((x) => x.text());
    assert.match(rb, /Sitemap: https:\/\/yu\.example\.com\/sitemap\.xml/);
  } finally {
    delete process.env.POND_BASE_URL;
  }
});
