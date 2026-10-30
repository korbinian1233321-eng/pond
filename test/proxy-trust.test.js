'use strict';

/**
 * Pond · 反向代理信任测试（反面）
 * 跑法：npm test
 *
 * 设了 POND_TRUST_PROXY=1 之后，X-Forwarded-For 才是可信的：
 * 每个来源 IP 各自一个桶，一个人刷快了不会拖累其他人。
 *
 * 这正是挂在 Caddy / Nginx / Cloudflare 后面必须设它的原因——
 * 不设的话，所有访客都被算成代理的 127.0.0.1，一个人就能把全站限流掉。
 */

const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const DB_FILE = path.join(os.tmpdir(), 'pond-proxy-trust-' + process.pid + '.db');
process.env.POND_DB = DB_FILE;
process.env.POND_DATA_DIR = path.dirname(DB_FILE);
process.env.POND_HOST = '127.0.0.1';
process.env.POND_SEED_FORCE = '1';
process.env.POND_TRUST_PROXY = '1';

const { server } = require('../server.js');

const WRITE_LIMIT = 90;
let base = '';

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

test('信任反代时，不同来源 IP 各自计数，不会互相拖累', async () => {
  const n = WRITE_LIMIT + 8;
  for (let i = 0; i < n; i++) {
    const res = await fetch(base + '/api/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': '198.51.100.' + (i % 250)
      },
      body: JSON.stringify({ username: 'nobody', password: 'definitely-wrong' })
    });
    await res.arrayBuffer();
    assert.notEqual(res.status, 429, `第 ${i + 1} 次就被限流了，说明 X-Forwarded-For 没被采信`);
  }
});

test('同一个来源 IP 连刷，照样会被挡住', async () => {
  let got429 = false;
  for (let i = 0; i < WRITE_LIMIT + 8; i++) {
    const res = await fetch(base + '/api/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': '192.0.2.7'
      },
      body: JSON.stringify({ username: 'nobody', password: 'definitely-wrong' })
    });
    await res.arrayBuffer();
    if (res.status === 429) { got429 = true; break; }
  }
  assert.ok(got429, '同一个 IP 刷了 98 次都没被挡，限流没生效');
});
