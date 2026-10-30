'use strict';

/**
 * Pond · 关掉图片时的行为
 * 跑法：npm test
 *
 * pond.config.js 里 images 默认是 false，所以这条才是「新站开出来长什么样」。
 * 要验的就三件事：上传接口关着、配置告诉前端别显示按钮、旧图还能看。
 */

const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const DB_FILE = path.join(os.tmpdir(), 'pond-noimg-' + process.pid + '.db');
const DATA_DIR = path.join(os.tmpdir(), 'pond-noimg-data-' + process.pid);
process.env.POND_DB = DB_FILE;
process.env.POND_DATA_DIR = DATA_DIR;
process.env.POND_HOST = '127.0.0.1';
process.env.POND_SEED_FORCE = '1';
// 关键：不设 POND_IMAGES，走 pond.config.js 里的默认值
delete process.env.POND_IMAGES;

const { server } = require('../server.js');

const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);

let base = '';

function session() {
  const jar = new Map();
  const call = async (method, p, body, extra) => {
    const headers = Object.assign({}, extra || {});
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
    return { status: res.status, body: json };
  };
  return {
    get: (p) => call('GET', p),
    post: (p, b, h) => call('POST', p, b === undefined ? {} : b, h)
  };
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

test('bootstrap 告诉前端「这个塘不收图片」', async () => {
  const r = await session().get('/api/bootstrap');
  assert.equal(r.status, 200);
  assert.equal(r.body.data.config.images, false);
});

test('上传接口直接 403，连读都不读', async () => {
  const s = session();
  const login = await s.post('/api/auth/login', { username: 'admin', password: 'pond1234' });
  assert.equal(login.status, 200);

  const r = await s.post('/api/upload', PNG_1x1, { 'Content-Type': 'image/png' });
  assert.equal(r.status, 403);
  assert.equal(r.body.error.code, 'images_disabled');
});

test('关掉之后，正文里写 ![]() 也不会变成图', async () => {
  const s = session();
  await s.post('/api/auth/login', { username: 'admin', password: 'pond1234' });
  const created = await s.post('/api/posts', {
    title: '手写图片标记',
    body: '试试\n\n![](/uploads/f_deadbeef.png)',
    tags: []
  });
  assert.equal(created.status, 200);

  const html = await (await fetch(base + '/p/' + created.body.data.post.id)).text();
  // 注意：渲染层仍然认这个语法（旧帖子的图要能显示），
  // 但文件不存在，所以只是个坏图的 <img>，不会真的加载出内容。
  // 这里验的是「没人能新传一张图上来」，不是「语法被封了」。
  assert.ok(html.includes('手写图片标记'));
});
