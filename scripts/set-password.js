#!/usr/bin/env node
/**
 * 改口令 / 提管理员。给「没有邮箱、忘了密码就没了」这件事兜个底。
 *
 *   node scripts/set-password.js admin              # 随机生成一个新口令
 *   node scripts/set-password.js admin 我的新口令    # 指定口令
 *   node scripts/set-password.js admin --admin      # 顺手提成管理员
 *   node scripts/set-password.js --list             # 看有哪些账号
 *
 * 改完会把这个账号的所有会话清掉——如果是被盗了才来改的，
 * 光换口令不踢掉旧会话等于没换。
 */
'use strict';

const crypto = require('node:crypto');
const { db } = require('../lib/db');
const { hashPassword } = require('../lib/auth');

const MIN_LEN = 8;

function listUsers() {
  const rows = db.prepare(
    'SELECT username, role, fish_name, created_at FROM users ORDER BY created_at ASC'
  ).all();
  if (!rows.length) {
    console.log('还没有任何账号。先把站点跑起来注册一个。');
    return;
  }
  console.log(`\n  ${rows.length} 个账号\n`);
  for (const r of rows) {
    const when = new Date(Number(r.created_at)).toISOString().slice(0, 10);
    console.log(`  ${r.username.padEnd(18)} ${r.role.padEnd(8)} ${r.fish_name}  ${when}`);
  }
  console.log('');
}

function setPassword(username, password, alsoAdmin) {
  const row = db.prepare('SELECT id, role FROM users WHERE username = ?').get(username);
  if (!row) {
    console.error(`没有叫 ${username} 的账号。先跑 node scripts/set-password.js --list 看看。`);
    process.exitCode = 1;
    return;
  }
  if (password.length < MIN_LEN) {
    console.error(`口令至少 ${MIN_LEN} 位。`);
    process.exitCode = 1;
    return;
  }

  const { hash, salt } = hashPassword(password);
  db.prepare('UPDATE users SET pass_hash = ?, pass_salt = ? WHERE id = ?').run(hash, salt, row.id);
  const killed = db.prepare('DELETE FROM sessions WHERE user_id = ?').run(row.id).changes;

  let role = row.role;
  if (alsoAdmin && role !== 'admin') {
    db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(row.id);
    role = 'admin';
  }

  console.log('');
  console.log(`  ${username} 的口令已更新（${role}）`);
  console.log(`  新口令：${password}`);
  if (killed) console.log(`  已踢掉 ${killed} 个登录会话`);
  console.log('');
}

function main(argv) {
  if (argv.includes('--list') || argv.includes('-l')) return listUsers();

  const args = argv.filter((a) => !a.startsWith('--'));
  const username = args[0];
  if (!username) {
    console.error('用法：node scripts/set-password.js <用户名> [新口令] [--admin]');
    console.error('      node scripts/set-password.js --list');
    process.exitCode = 1;
    return;
  }

  // 不给口令就生成一个。比让人随手敲个 123456 强。
  const password = args[1] || crypto.randomBytes(9).toString('base64url');
  setPassword(username, password, argv.includes('--admin'));
}

main(process.argv.slice(2));
