'use strict';

/**
 * Pond · 反向代理信任测试
 * 跑法：npm test
 *
 * 盯的是这个：直连公网时，客户端自己填的 X-Forwarded-For 必须被无视。
 * 否则攻击者每次请求换一个假 IP，按 IP 的限流就形同虚设——
 * 登录爆破可以无限次试，聊天室连接上限也可以随便绕。
 *
 * 同目录下的 proxy-trust.test.js 是反面：设了 POND_TRUST_PROXY=1 之后，
 * 每个 X-Forwarded-For 应当各自成桶，互不牵连。
 */

const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const DB_FILE = path.join(os.tmpdir(), 'pond-proxy-' + process.pid + '.db');
process.env.POND_DB = DB_FILE;
process.env.POND_DATA_DIR = path.dirname(DB_FILE);
process.env.POND_HOST = '127.0.0.1';
process.env.POND_SEED_FORCE = '1';
delete process.env.POND_TRUST_PROXY;

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

/** 每次请求都换一个伪造的 X-Forwarded-For */
async function spamLogin(n) {
  let first429 = null;
  for (let i = 0; i < n; i++) {
    const res = await fetch(base + '/api/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': '203.0.113.' + (i % 250)
      },
      body: JSON.stringify({ username: 'nobody', password: 'definitely-wrong' })
    });
    await res.arrayBuffer();
    if (res.status === 429 && first429 === null) first429 = i + 1;
  }
  return first429;
}

test('直连时，换着填 X-Forwarded-For 也绕不过写限流', async () => {
  const at = await spamLogin(WRITE_LIMIT + 8);
  assert.ok(at !== null, `伪造了 ${WRITE_LIMIT + 8} 个不同 IP，仍然应该在 ${WRITE_LIMIT} 次左右被限流`);
  assert.ok(at > WRITE_LIMIT, `第 ${at} 次就被挡了，限流阈值看起来不对`);
  assert.ok(at <= WRITE_LIMIT + 1, `第 ${at} 次才挡，比预期的 ${WRITE_LIMIT + 1} 晚，中间有请求漏过计数`);
});
