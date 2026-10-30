#!/usr/bin/env node
/**
 * 邀请码命令行。给「塘刚开、一个人都还没有」这个时刻用的——
 * 网页上的邀请面板要先登录才看得见，可第一个能登录的人从哪来？
 *
 *   node scripts/invite.js new                    # 造一个，14 天后作废
 *   node scripts/invite.js new --note "给阿金"     # 带个备注，方便记是给谁的
 *   node scripts/invite.js new --by admin         # 记在某个账号名下
 *   node scripts/invite.js new --days 3           # 改有效期
 *   node scripts/invite.js list                   # 看全部码和它们的下场
 *   node scripts/invite.js revoke ABCD-EFGH       # 撤掉一个还没用的
 *
 * 站长自己的账号（POND_ADMIN）注册时不需要码，所以理论上不跑这个也能开张。
 * 但那是留给「只有我一个」的阶段；想拉人进来，还是得有码。
 */
'use strict';

const { db } = require('../lib/db');
const invite = require('../lib/invite');

const DAY = 24 * 60 * 60 * 1000;

function fmt(ms) {
  return new Date(Number(ms)).toISOString().slice(0, 16).replace('T', ' ');
}

/** 找这个码是谁发出去的 */
function inviterName(createdBy) {
  if (!createdBy || createdBy === 'system') return '（命令行）';
  const u = db.prepare('SELECT username FROM users WHERE id = ?').get(createdBy);
  return u ? u.username : createdBy;
}

function statusOf(row) {
  if (row.used_by) return '已使用';
  if (Number(row.expires_at) <= Date.now()) return '已过期';
  return '可用';
}

function list() {
  const rows = db.prepare('SELECT * FROM invites ORDER BY created_at DESC LIMIT 100').all();
  if (!rows.length) {
    console.log('\n  还没有邀请码。跑 node scripts/invite.js new 造一个。\n');
    return;
  }
  const live = rows.filter((r) => statusOf(r) === '可用').length;
  console.log(`\n  ${rows.length} 个邀请码，其中 ${live} 个还能用\n`);
  for (const r of rows) {
    const code = invite.display(r.code);
    const st = statusOf(r);
    const who = r.used_by
      ? (db.prepare('SELECT username FROM users WHERE id = ?').get(r.used_by) || {}).username || '?'
      : '';
    console.log(
      `  ${code}  ${st.padEnd(4)}  ${fmt(r.expires_at)}  ${inviterName(r.created_by)}` +
      (r.note ? `  「${r.note}」` : '') +
      (who ? `  → ${who}` : '')
    );
  }
  console.log('');
}

function create(opts) {
  let actor;
  if (opts.by) {
    const u = db.prepare('SELECT id, username, role FROM users WHERE username = ?').get(opts.by.toLowerCase());
    if (!u) {
      console.error(`没有叫 ${opts.by} 的账号。跑 node scripts/set-password.js --list 看看。`);
      process.exitCode = 1;
      return;
    }
    actor = u;
  } else {
    // 没有发起人就用一个假的管理员身份：命令行本来就不受配额限制
    actor = { id: 'system', role: 'admin' };
  }

  if (opts.days) invite.settings.ttlMs = opts.days * DAY;

  const made = invite.create(actor, opts.note);
  if (!made) {
    console.error(`${actor.username || '这个账号'} 手上的码还没用完，先等它们被用掉。`);
    process.exitCode = 1;
    return;
  }

  console.log('');
  console.log(`  邀请码：${made.code}`);
  console.log(`  有效期到：${fmt(made.expiresAt)}`);
  if (made.note) console.log(`  备注：${made.note}`);
  console.log(`  发码人：${inviterName(actor.id)}`);
  console.log('');
  console.log('  把这个码发给要请的人，注册时填进去就行。只能用一次。');
  console.log('');
}

function revoke(code) {
  const c = invite.normalize(code);
  const row = db.prepare('SELECT * FROM invites WHERE code = ?').get(c);
  if (!row) {
    console.error(`没有这个码：${code}`);
    process.exitCode = 1;
    return;
  }
  if (row.used_by) {
    console.error('这个码已经被用掉了，撤不回来。要踢人就封号。');
    process.exitCode = 1;
    return;
  }
  db.prepare('DELETE FROM invites WHERE id = ?').run(row.id);
  console.log(`已撤销 ${invite.display(row.code)}`);
}

function main(argv) {
  const cmd = argv[0] && !argv[0].startsWith('-') ? argv[0] : 'list';
  const rest = argv.slice(cmd === argv[0] ? 1 : 0);

  const flag = (name) => {
    const i = rest.indexOf('--' + name);
    return i >= 0 ? rest[i + 1] : null;
  };

  if (cmd === 'new' || cmd === 'create') {
    return create({
      by: flag('by'),
      note: flag('note') || '',
      days: flag('days') ? Number(flag('days')) : 0
    });
  }
  if (cmd === 'list' || cmd === 'ls') return list();
  if (cmd === 'revoke' || cmd === 'rm') {
    const code = rest[0];
    if (!code || code.startsWith('-')) {
      console.error('用法：node scripts/invite.js revoke <邀请码>');
      process.exitCode = 1;
      return;
    }
    return revoke(code);
  }

  console.error('用法：');
  console.error('  node scripts/invite.js new [--note 备注] [--by 用户名] [--days 天数]');
  console.error('  node scripts/invite.js list');
  console.error('  node scripts/invite.js revoke <邀请码>');
  process.exitCode = 1;
}

main(process.argv.slice(2));
