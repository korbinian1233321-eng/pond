#!/usr/bin/env node
/**
 * 直接在服务器上建号。给 registration: 'closed' 的塘用——
 * 关掉注册之后，网页上没有任何入口能多出一条鱼，只能从这里进。
 *
 *   node scripts/add-user.js ajin                      # 随机口令
 *   node scripts/add-user.js ajin 我的口令              # 指定口令
 *   node scripts/add-user.js ajin --admin              # 顺便给管理员
 *   node scripts/add-user.js ajin --fish 青柠气泡        # 指定鱼名（中文放这里）
 *
 * 账号名会被转成小写，规则和网页注册一致（3–24 位小写字母、数字、下划线、短横线）——
 * 中文不能当账号，只能当鱼名。
 * 建出来的号没有 invited_by，所以要等满 24 小时才能开新楼——
 * 想让某人立刻能发帖，用邀请码那条路（scripts/invite.js）而不是这个。
 */
'use strict';

const crypto = require('node:crypto');
const { db, uid, now } = require('../lib/db');
const { hashPassword } = require('../lib/auth');

const MIN_LEN = 8;
const NAME_RE = /^[a-z0-9_-]{3,24}$/;

function main(argv) {
  const flag = (name) => {
    const i = argv.indexOf('--' + name);
    return i >= 0 ? argv[i + 1] : null;
  };
  const positional = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--fish');
  const username = String(positional[0] || '').toLowerCase();
  const password = positional[1] || crypto.randomBytes(9).toString('base64url');
  const asAdmin = argv.includes('--admin');
  const fishName = flag('fish') || username;

  if (!username) {
    console.error('用法：node scripts/add-user.js <账号> [口令] [--admin] [--fish 鱼名]');
    process.exitCode = 1;
    return;
  }
  if (!NAME_RE.test(username)) {
    console.error('账号要用 3–24 位小写字母、数字、下划线或短横线。');
    process.exitCode = 1;
    return;
  }
  if (password.length < MIN_LEN) {
    console.error(`口令至少 ${MIN_LEN} 位。`);
    process.exitCode = 1;
    return;
  }
  if (db.prepare('SELECT 1 AS x FROM users WHERE username = ?').get(username)) {
    console.error(`已经有一个叫 ${username} 的账号了。改口令用 node scripts/set-password.js ${username}`);
    process.exitCode = 1;
    return;
  }

  const { hash, salt } = hashPassword(password);
  const id = uid('u');
  db.prepare(
    `INSERT INTO users (id, username, pass_hash, pass_salt, fish_name, fish_type, bio, role, invited_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, '', ?, NULL, ?)`
  ).run(id, username, hash, salt, fishName, '女仆鲸', asAdmin ? 'admin' : 'member', now());

  console.log('');
  console.log(`  建好了：${username}（${asAdmin ? '管理员' : '普通成员'}）`);
  console.log(`  口令：${password}`);
  console.log(`  鱼名：${fishName}`);
  console.log('');
  if (!asAdmin) {
    console.log('  这个号没有邀请人，要等满 24 小时才能开新楼。');
    console.log('');
  }
}

main(process.argv.slice(2));
