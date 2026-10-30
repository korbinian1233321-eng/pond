#!/usr/bin/env node
/**
 * 备份。数据库 + 上传的图，各留一份。
 *
 *   node scripts/backup.js                 # 备份到 ../backup
 *   node scripts/backup.js /mnt/disk/bak    # 指定目录
 *
 * 为什么不用 cp：SQLite 在 WAL 模式下正在写的时候直接拷文件，
 * 拷出来的可能是「一半是旧的一半是新的」。用 VACUUM INTO 让 SQLite
 * 自己把一致性快照写出来，服务不用停。
 *
 * 只备份数据库不备份 uploads，恢复之后所有帖子里的图都会变成裂图——
 * 这个坑我在 DEPLOY.md 里写过，这里就用代码堵上。
 */
'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = process.env.POND_DATA_DIR || path.join(__dirname, '..', 'data');
const DB_FILE = process.env.POND_DB || path.join(DATA_DIR, 'pond.db');
const UPLOADS = path.join(DATA_DIR, 'uploads');
const OUT = process.argv[2] || process.env.POND_BACKUP_DIR || path.join(path.dirname(DATA_DIR), 'backup');
const KEEP = Math.max(1, Number(process.env.POND_BACKUP_KEEP) || 7);

function stamp(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

/** 目录按名字倒序，删掉超出的那些 */
function prune(dir, prefix, keep) {
  const entries = fs.readdirSync(dir)
    .filter((n) => n.startsWith(prefix))
    .sort()
    .reverse();
  for (const old of entries.slice(keep)) {
    fs.rmSync(path.join(dir, old), { recursive: true, force: true });
    console.log('  清理旧备份 ' + old);
  }
}

function main() {
  if (!fs.existsSync(DB_FILE)) {
    console.error(`找不到数据库：${DB_FILE}`);
    console.error('先确认 POND_DATA_DIR 指对了，或者服务至少启动过一次。');
    process.exitCode = 1;
    return;
  }

  fs.mkdirSync(OUT, { recursive: true });
  const now = new Date();
  const tag = stamp(now);

  // 1. 数据库
  const dbTarget = path.join(OUT, `pond-${tag}.db`);
  const db = new DatabaseSync(DB_FILE, { readOnly: true });
  try {
    // VACUUM INTO 要求目标文件不存在
    fs.rmSync(dbTarget, { force: true });
    db.exec(`VACUUM INTO '${dbTarget.replace(/'/g, "''")}'`);
  } finally {
    db.close();
  }
  const dbSize = (fs.statSync(dbTarget).size / 1024).toFixed(0);
  console.log(`  数据库  ${dbTarget}  ${dbSize} KB`);

  // 2. 图片。没有就跳过——图片功能默认是关的
  if (fs.existsSync(UPLOADS)) {
    const upTarget = path.join(OUT, `uploads-${tag}`);
    fs.cpSync(UPLOADS, upTarget, { recursive: true });
    const n = fs.readdirSync(upTarget).length;
    console.log(`  图片    ${upTarget}  ${n} 个文件`);
  } else {
    console.log('  图片    没有 uploads 目录，跳过');
  }

  // 3. 只留最近 KEEP 份
  prune(OUT, 'pond-', KEEP);
  prune(OUT, 'uploads-', KEEP);
  console.log(`  完成。${OUT} 里保留最近 ${KEEP} 份。`);
}

main();
