'use strict';

/**
 * Pond · API
 * 纯 JSON 接口，全部走 /api/*。
 * 约定：成功 { ok:true, data }，失败 { ok:false, error:{ code, message } }。
 */

const { db, uid, now, parseTags } = require('./db');
const auth = require('./auth');
const chat = require('./chat');
const upload = require('./upload');
const { ok, fail, readBody, readRaw, rateLimit, HttpError } = require('./http');

const LIMITS = {
  title: 80,
  body: 8000,
  quote: 140,
  floor: 4000,
  reply: 1000,
  chat: 500,
  bio: 160,
  username: 24,
  password: 128,
  reason: 300,
  tags: 2,
  tagLen: 12
};

/* ---------- 小工具 ---------- */

/**
 * POND_ADMIN=yourname 时，这个账号注册即管理员。
 * 自托管社区没有「第一个用户自动当管理员」这种魔法（会被抢注），
 * 所以让人自己声明，比事后改数据库友好。
 */
function roleForNewUser(username) {
  const admin = String(process.env.POND_ADMIN || '').trim().toLowerCase();
  return admin && username === admin ? 'admin' : 'member';
}

function str(v, max) {
  if (typeof v !== 'string') return '';
  const s = v.replace(/\r\n/g, '\n').replace(/\u0000/g, '').trim();
  return s.length > max ? s.slice(0, max) : s;
}

function bad(message, code) {
  return new HttpError(400, code || 'bad_request', message);
}

function getPostRow(id) {
  return db.prepare('SELECT * FROM posts WHERE id = ? AND deleted = 0').get(id);
}
function getFloorRow(id) {
  return db.prepare('SELECT * FROM floors WHERE id = ? AND deleted = 0').get(id);
}
function getReplyRow(id) {
  return db.prepare('SELECT * FROM replies WHERE id = ? AND deleted = 0').get(id);
}
function getUserRow(id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

function briefUser(id) {
  const u = getUserRow(id);
  if (!u) return { id, fishName: '已注销的鱼', fishType: '', username: '' };
  return {
    id: u.id,
    username: u.username,
    fishName: u.fish_name,
    fishType: u.fish_type,
    bio: u.bio,
    role: u.role
  };
}

function notify(userId, type, actorId, postId, floorId, text) {
  if (!userId || userId === actorId) return;
  db.prepare(
    `INSERT INTO notifications (id, user_id, type, actor_id, post_id, floor_id, text, read, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`
  ).run(uid('n'), userId, type, actorId || null, postId || null, floorId || null, text || '', now());
}

function votedSet(userId, type, ids) {
  const set = new Set();
  if (!userId || !ids.length) return set;
  const ph = ids.map(() => '?').join(',');
  const rows = db.prepare(
    `SELECT target_id FROM votes WHERE user_id = ? AND target_type = ? AND target_id IN (${ph})`
  ).all(userId, type, ...ids);
  for (const r of rows) set.add(r.target_id);
  return set;
}

/* ---------- 鱼汛 ---------- */

function chatMessage(row) {
  return {
    id: row.id,
    body: row.body,
    createdAt: row.created_at,
    author: briefUser(row.user_id)
  };
}

function chatHistory({ limit, before, after }) {
  const lim = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 100);

  // after：断线重连后补齐漏掉的部分，正序取
  if (Number.isFinite(after) && after > 0) {
    const rows = db.prepare(
      'SELECT * FROM chat_messages WHERE deleted = 0 AND created_at > ? ORDER BY created_at ASC LIMIT ?'
    ).all(after, lim);
    return { items: rows.map(chatMessage), hasMore: rows.length === lim };
  }

  // 其余情况：倒序取最近的一批，再翻回正序给前端
  const useBefore = Number.isFinite(before) && before > 0;
  const rows = db.prepare(
    'SELECT * FROM chat_messages WHERE deleted = 0' + (useBefore ? ' AND created_at < ?' : '') +
    ' ORDER BY created_at DESC LIMIT ?'
  ).all(...(useBefore ? [before, lim] : [lim]));
  rows.reverse();
  return { items: rows.map(chatMessage), hasMore: rows.length === lim };
}

/* ---------- 视图组装 ---------- */

function postSummary(row, meId, voted, bookmarked) {
  const floorCount = db.prepare('SELECT COUNT(*) AS n FROM floors WHERE post_id = ? AND deleted = 0')
    .get(row.id).n;
  const replyCount = db.prepare('SELECT COUNT(*) AS n FROM replies WHERE post_id = ? AND deleted = 0')
    .get(row.id).n;
  const food = db.prepare("SELECT COUNT(*) AS n FROM votes WHERE target_type = 'post' AND target_id = ?")
    .get(row.id).n;
  const last = db.prepare(
    `SELECT MAX(ts) AS t FROM (
       SELECT created_at AS ts FROM floors WHERE post_id = ? AND deleted = 0
       UNION ALL
       SELECT created_at AS ts FROM replies WHERE post_id = ? AND deleted = 0
     )`
  ).get(row.id, row.id).t;

  return {
    id: row.id,
    title: row.title,
    quote: row.quote,
    tags: parseTags(row.tags),
    author: briefUser(row.author_id),
    pinned: !!row.pinned,
    locked: !!row.locked,
    createdAt: row.created_at,
    lastReplyAt: Math.max(row.created_at, last || 0),
    floorCount,
    replyCount,
    food,
    voted: voted ? voted.has(row.id) : false,
    bookmarked: bookmarked ? bookmarked.has(row.id) : false
  };
}

function fullPost(row, meId) {
  const postVoted = votedSet(meId, 'post', [row.id]).has(row.id);
  const summary = postSummary(row, meId, postVoted ? new Set([row.id]) : new Set(), null);

  const floorRows = db.prepare(
    'SELECT * FROM floors WHERE post_id = ? AND deleted = 0 ORDER BY created_at ASC'
  ).all(row.id);

  const floorIds = floorRows.map((f) => f.id);
  const fVoted = votedSet(meId, 'floor', floorIds);

  let replyRows = [];
  if (floorIds.length) {
    const ph = floorIds.map(() => '?').join(',');
    replyRows = db.prepare(
      `SELECT * FROM replies WHERE floor_id IN (${ph}) AND deleted = 0 ORDER BY created_at ASC`
    ).all(...floorIds);
  }
  const rVoted = votedSet(meId, 'reply', replyRows.map((r) => r.id));

  const foodOf = (type) => {
    const m = new Map();
    const rows = db.prepare(`SELECT target_id, COUNT(*) AS n FROM votes WHERE target_type = ? GROUP BY target_id`)
      .all(type);
    for (const r of rows) m.set(r.target_id, r.n);
    return m;
  };
  const fFood = foodOf('floor');
  const rFood = foodOf('reply');

  const repliesByFloor = new Map();
  for (const r of replyRows) {
    if (!repliesByFloor.has(r.floor_id)) repliesByFloor.set(r.floor_id, []);
    repliesByFloor.get(r.floor_id).push({
      id: r.id,
      body: r.body,
      author: briefUser(r.author_id),
      toUser: r.to_user_id ? briefUser(r.to_user_id) : null,
      createdAt: r.created_at,
      food: rFood.get(r.id) || 0,
      voted: rVoted.has(r.id)
    });
  }

  summary.floors = floorRows.map((f, i) => ({
    id: f.id,
    num: i + 2,
    body: f.body,
    author: briefUser(f.author_id),
    isOP: f.author_id === row.author_id,
    createdAt: f.created_at,
    food: fFood.get(f.id) || 0,
    voted: fVoted.has(f.id),
    replies: repliesByFloor.get(f.id) || []
  }));

  summary.body = row.body;
  summary.bookmarked = meId
    ? !!db.prepare('SELECT 1 AS x FROM bookmarks WHERE user_id = ? AND post_id = ?').get(meId, row.id)
    : false;
  summary.followingAuthor = meId
    ? !!db.prepare('SELECT 1 AS x FROM follows WHERE follower_id = ? AND followee_id = ?')
      .get(meId, row.author_id)
    : false;

  return summary;
}

/* ---------- 帖子列表 ---------- */

function listPosts({ meId, tag, q, sort, authorId, onlyBookmarked, onlyFollowing, page, limit }) {
  const where = ['p.deleted = 0'];
  const params = [];

  if (tag) {
    where.push('p.tags LIKE ?');
    params.push('%"' + tag.replace(/[%_"]/g, '') + '"%');
  }
  if (authorId) {
    where.push('p.author_id = ?');
    params.push(authorId);
  }
  if (q) {
    where.push('(p.title LIKE ? OR p.body LIKE ? OR p.quote LIKE ? OR u.fish_name LIKE ?)');
    const like = '%' + q.replace(/[%_]/g, '') + '%';
    params.push(like, like, like, like);
  }
  if (onlyBookmarked) {
    where.push('EXISTS (SELECT 1 FROM bookmarks b WHERE b.post_id = p.id AND b.user_id = ?)');
    params.push(meId);
  }
  if (onlyFollowing) {
    where.push('EXISTS (SELECT 1 FROM follows f WHERE f.followee_id = p.author_id AND f.follower_id = ?)');
    params.push(meId);
  }

  const rows = db.prepare(
    `SELECT p.* FROM posts p JOIN users u ON u.id = p.author_id
     WHERE ${where.join(' AND ')}
     ORDER BY p.created_at DESC LIMIT 600`
  ).all(...params);

  const ids = rows.map((r) => r.id);
  const postVoted = votedSet(meId, 'post', ids);
  const bookmarked = new Set();
  if (meId && ids.length) {
    const ph = ids.map(() => '?').join(',');
    const bs = db.prepare(`SELECT post_id FROM bookmarks WHERE user_id = ? AND post_id IN (${ph})`)
      .all(meId, ...ids);
    for (const b of bs) bookmarked.add(b.post_id);
  }

  let items = rows.map((r) => postSummary(r, meId, postVoted, bookmarked));

  if (sort === 'fat') {
    const t = now();
    items.sort((a, b) => {
      const ha = (t - a.createdAt) / 3600000;
      const hb = (t - b.createdAt) / 3600000;
      return b.food / Math.pow(hb + 2, 0.8) - a.food / Math.pow(ha + 2, 0.8);
    });
  } else if (sort === 'reply') {
    items.sort((a, b) => b.lastReplyAt - a.lastReplyAt);
  } else {
    items.sort((a, b) => b.createdAt - a.createdAt);
  }

  // 置顶永远在最前
  items.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));

  const total = items.length;
  const lim = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 50);
  const pg = Math.max(parseInt(page, 10) || 1, 1);
  const slice = items.slice((pg - 1) * lim, pg * lim);

  return { items: slice, total, page: pg, limit: lim, hasMore: pg * lim < total };
}

function tagCounts(allowed) {
  const list = Array.isArray(allowed) ? allowed : [];
  const rows = db.prepare('SELECT tags FROM posts WHERE deleted = 0').all();
  const m = new Map(list.map((t) => [t, 0]));
  for (const r of rows) {
    for (const t of parseTags(r.tags)) m.set(t, (m.get(t) || 0) + 1);
  }
  return Array.from(m, ([name, count]) => ({ name, count }));
}

function stats() {
  const posts = db.prepare('SELECT COUNT(*) AS n FROM posts WHERE deleted = 0').get().n;
  const floors = db.prepare('SELECT COUNT(*) AS n FROM floors WHERE deleted = 0').get().n;
  const replies = db.prepare('SELECT COUNT(*) AS n FROM replies WHERE deleted = 0').get().n;
  const users = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  const members = db.prepare('SELECT COUNT(*) AS n FROM pond_members').get().n;
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const today = db.prepare('SELECT COUNT(*) AS n FROM posts WHERE deleted = 0 AND created_at >= ?')
    .get(dayStart.getTime()).n;
  const recent = db.prepare('SELECT COUNT(*) AS n FROM posts WHERE deleted = 0 AND created_at >= ?')
    .get(now() - 24 * 3600 * 1000).n;
  return { posts, floors, replies, users, members, today, recent };
}

function mePayload(row) {
  if (!row) return null;
  const u = auth.publicUser(row);
  const unread = db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read = 0')
    .get(row.id).n;
  const bookmarks = db.prepare('SELECT COUNT(*) AS n FROM bookmarks WHERE user_id = ?').get(row.id).n;
  const following = db.prepare('SELECT COUNT(*) AS n FROM follows WHERE follower_id = ?').get(row.id).n;
  const inPond = !!db.prepare('SELECT 1 AS x FROM pond_members WHERE user_id = ?').get(row.id);
  return { ...u, unread, bookmarks, following, inPond };
}

/* ---------- 路由 ---------- */

async function handle(req, res, ctx) {
  const url = new URL(req.url, 'http://localhost');
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const method = req.method.toUpperCase();
  const q = url.searchParams;
  const me = ctx.user;
  const meId = me ? me.id : null;
  const write = method !== 'GET';

  if (write && !rateLimit('w:' + ctx.ip, 90, 60 * 1000)) {
    return fail(res, 429, 'rate_limited', '操作太频繁了，喘口气');
  }
  if (!write && !rateLimit('r:' + ctx.ip, 600, 60 * 1000)) {
    return fail(res, 429, 'rate_limited', '请求太频繁了');
  }

  let body = {};
  if (write) {
    const ct = (req.headers['content-type'] || '').toLowerCase();

    // 上传走原始字节，不是 JSON：不收 multipart 是因为内置模块里没有解析器，
    // 手写一个比直接用 fetch(file) 当 body 更容易出错。
    if (path === '/api/upload' && method === 'POST') {
      if (!me) return fail(res, 401, 'unauthorized', '先登录再传图');
      if (!ctx.config.images) {
        return fail(res, 403, 'images_disabled', '这个塘暂时不收图片，先文字聊');
      }
      if (!rateLimit('up:' + me.id, 20, 60 * 1000)) {
        return fail(res, 429, 'rate_limited', '传得太快了，缓一下');
      }
      // 先看 Content-Length。有的话连读都不用读，直接告诉对方太大了——
      // 比读满 5MB 再拒绝省事，用户也能立刻看到原因。
      const declared = Number(req.headers['content-length']);
      if (Number.isFinite(declared) && declared > upload.MAX_BYTES) {
        return fail(res, 413, 'payload_too_large',
          `图片太大了，上限 ${Math.round(upload.MAX_BYTES / 1024 / 1024)}MB`);
      }
      const buf = await readRaw(req, upload.MAX_BYTES);
      try {
        return ok(res, upload.save(me.id, buf));
      } catch (e) {
        const status = e.code === 'too_large' ? 413
          : e.code === 'quota' ? 429
            : e.code === 'bad_type' ? 415
              : 400;
        throw new HttpError(status, e.code || 'upload_failed', e.message);
      }
    }

    if (!ct.includes('application/json')) {
      return fail(res, 415, 'unsupported_media_type', '只接受 application/json');
    }
    body = await readBody(req);
  }

  const needAuth = () => {
    if (!me) throw new HttpError(401, 'unauthorized', '先登录再操作');
    return me;
  };
  const needMod = () => {
    const u = needAuth();
    if (u.role !== 'mod' && u.role !== 'admin') {
      throw new HttpError(403, 'forbidden', '这需要版主权限');
    }
    return u;
  };

  /* ---- 元信息 ---- */
  if (path === '/api/bootstrap' && method === 'GET') {
    return ok(res, {
      config: ctx.config,
      me: mePayload(me),
      tags: tagCounts(ctx.config.tags),
      stats: stats(),
      chat: chat.presence()
    });
  }

  /* ---- 图片 ---- */
  if (path.startsWith('/api/uploads/') && method === 'DELETE') {
    const u = needAuth();
    const id = path.slice('/api/uploads/'.length);
    try {
      const gone = upload.remove(u.id, id, u.role === 'mod' || u.role === 'admin');
      if (!gone) return fail(res, 404, 'not_found', '这张图不在了');
      return ok(res, { removed: id });
    } catch (e) {
      if (e.code === 'forbidden') return fail(res, 403, 'forbidden', e.message);
      throw e;
    }
  }

  /* ---- 鉴权 ---- */
  if (path === '/api/auth/register' && method === 'POST') {
    const username = str(body.username, LIMITS.username).toLowerCase();
    const password = typeof body.password === 'string' ? body.password : '';
    const fishName = str(body.fishName, LIMITS.username) || username;
    const fishType = str(body.fishType, LIMITS.tagLen) || '女仆鲸';

    if (!/^[a-z0-9_-]{3,24}$/.test(username)) {
      return fail(res, 400, 'bad_username', '账号用 3–24 位小写字母、数字、下划线或短横线');
    }
    if (password.length < 8) return fail(res, 400, 'weak_password', '密码至少 8 位');
    if (password.length > LIMITS.password) return fail(res, 400, 'long_password', '密码太长了');
    if (db.prepare('SELECT 1 AS x FROM users WHERE username = ?').get(username)) {
      return fail(res, 409, 'username_taken', '这个账号已经有人用了');
    }

    const { hash, salt } = auth.hashPassword(password);
    const id = uid('u');
    const t = now();
    db.prepare(
      `INSERT INTO users (id, username, pass_hash, pass_salt, fish_name, fish_type, bio, role, created_at)
       VALUES (?, ?, ?, ?, ?, ?, '', ?, ?)`
    ).run(id, username, hash, salt, fishName, fishType, roleForNewUser(username), t);

    const { token } = auth.createSession(id);
    return ok(res, { me: mePayload(getUserRow(id)) }, {
      'Set-Cookie': auth.sessionCookie(token, auth.SESSION_TTL / 1000)
    });
  }

  if (path === '/api/auth/login' && method === 'POST') {
    const username = str(body.username, LIMITS.username).toLowerCase();
    const password = typeof body.password === 'string' ? body.password : '';
    const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!row || !auth.verifyPassword(password, row)) {
      return fail(res, 401, 'bad_credentials', '账号或密码不对');
    }
    const { token } = auth.createSession(row.id);
    return ok(res, { me: mePayload(row) }, {
      'Set-Cookie': auth.sessionCookie(token, auth.SESSION_TTL / 1000)
    });
  }

  if (path === '/api/auth/logout' && method === 'POST') {
    auth.destroySession(ctx.token);
    return ok(res, { ok: true }, { 'Set-Cookie': auth.clearCookie() });
  }

  if (path === '/api/me' && method === 'GET') {
    return ok(res, { me: mePayload(me) });
  }

  if (path === '/api/me/profile' && method === 'POST') {
    const u = needAuth();
    const fishName = str(body.fishName, LIMITS.username);
    const fishType = str(body.fishType, LIMITS.tagLen);
    const bio = str(body.bio, LIMITS.bio);
    if (fishName) db.prepare('UPDATE users SET fish_name = ? WHERE id = ?').run(fishName, u.id);
    if (fishType) db.prepare('UPDATE users SET fish_type = ? WHERE id = ?').run(fishType, u.id);
    db.prepare('UPDATE users SET bio = ? WHERE id = ?').run(bio, u.id);
    return ok(res, { me: mePayload(getUserRow(u.id)) });
  }

  /* ---- 帖子 ---- */
  if (path === '/api/posts' && method === 'GET') {
    const data = listPosts({
      meId,
      tag: q.get('tag') || '',
      q: str(q.get('q'), 60),
      sort: q.get('sort') || 'fat',
      page: q.get('page'),
      limit: q.get('limit')
    });
    return ok(res, data);
  }

  if (path === '/api/posts' && method === 'POST') {
    const u = needAuth();
    const allowedTags = Array.isArray(ctx.config.tags) ? ctx.config.tags : [];
    if (!auth.canPost(u)) {
      return fail(res, 403, 'trust_too_low', '新鱼第一天只能回复。先去盖两层楼，或者等 24 小时。');
    }
    const title = str(body.title, LIMITS.title);
    const text = str(body.body, LIMITS.body);
    const quote = str(body.quote, LIMITS.quote);
    if (text.length < 2) return fail(res, 400, 'empty_body', '正文还是空的');

    let tags = Array.isArray(body.tags) ? body.tags.filter((t) => allowedTags.includes(t)) : [];
    tags = Array.from(new Set(tags)).slice(0, LIMITS.tags);

    const finalTitle = title || text.split('\n')[0].slice(0, 30);
    const id = uid('p');
    db.prepare(
      `INSERT INTO posts (id, title, body, quote, tags, author_id, pinned, locked, deleted, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0, ?)`
    ).run(id, finalTitle, text, quote, JSON.stringify(tags), u.id, now());

    return ok(res, { post: fullPost(getPostRow(id), u.id) });
  }

  let m = path.match(/^\/api\/posts\/([\w-]+)$/);
  if (m && method === 'GET') {
    const row = getPostRow(m[1]);
    if (!row) return fail(res, 404, 'not_found', '这层楼不在了');
    return ok(res, { post: fullPost(row, meId) });
  }

  m = path.match(/^\/api\/posts\/([\w-]+)\/floors$/);
  if (m && method === 'POST') {
    const u = needAuth();
    const row = getPostRow(m[1]);
    if (!row) return fail(res, 404, 'not_found', '这层楼不在了');
    if (row.locked) return fail(res, 403, 'locked', '这层楼已经锁了');
    const text = str(body.body, LIMITS.floor);
    if (!text) return fail(res, 400, 'empty', '空着发不出去');

    const id = uid('f');
    db.prepare('INSERT INTO floors (id, post_id, author_id, body, deleted, created_at) VALUES (?, ?, ?, ?, 0, ?)')
      .run(id, row.id, u.id, text, now());
    notify(row.author_id, 'floor', u.id, row.id, id, '在你开的楼里占了一层');

    return ok(res, { post: fullPost(getPostRow(row.id), u.id) });
  }

  m = path.match(/^\/api\/floors\/([\w-]+)\/replies$/);
  if (m && method === 'POST') {
    const u = needAuth();
    const floor = getFloorRow(m[1]);
    if (!floor) return fail(res, 404, 'not_found', '这一层不在了');
    const post = getPostRow(floor.post_id);
    if (!post) return fail(res, 404, 'not_found', '这层楼不在了');
    if (post.locked) return fail(res, 403, 'locked', '这层楼已经锁了');

    const text = str(body.body, LIMITS.reply);
    if (!text) return fail(res, 400, 'empty', '空着发不出去');
    const toUserId = body.toUserId && getUserRow(body.toUserId) ? body.toUserId : null;

    const id = uid('r');
    db.prepare(
      `INSERT INTO replies (id, post_id, floor_id, author_id, to_user_id, body, deleted, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?)`
    ).run(id, post.id, floor.id, u.id, toUserId, text, now());

    notify(floor.author_id, 'reply', u.id, post.id, floor.id, '回复了你的楼层');
    if (toUserId && toUserId !== floor.author_id) {
      notify(toUserId, 'reply', u.id, post.id, floor.id, '在楼中楼里回复了你');
    }

    return ok(res, { post: fullPost(post, u.id) });
  }

  /* ---- 投喂 / 鱼篓 / 关注 ---- */
  if (path === '/api/vote' && method === 'POST') {
    const u = needAuth();
    const type = body.targetType;
    const id = body.targetId;
    if (!['post', 'floor', 'reply'].includes(type)) throw bad('未知的投喂对象');
    const exists = type === 'post' ? getPostRow(id) : type === 'floor' ? getFloorRow(id) : getReplyRow(id);
    if (!exists) return fail(res, 404, 'not_found', '这条内容不在了');

    const has = db.prepare('SELECT 1 AS x FROM votes WHERE user_id = ? AND target_type = ? AND target_id = ?')
      .get(u.id, type, id);
    if (has) {
      db.prepare('DELETE FROM votes WHERE user_id = ? AND target_type = ? AND target_id = ?')
        .run(u.id, type, id);
    } else {
      db.prepare('INSERT INTO votes (user_id, target_type, target_id, created_at) VALUES (?, ?, ?, ?)')
        .run(u.id, type, id, now());
      const ownerId = type === 'post' ? exists.author_id : exists.author_id;
      const postId = type === 'post' ? id : exists.post_id;
      notify(ownerId, 'vote', u.id, postId, type === 'floor' ? id : null, '给你投了一把鱼粮');
    }
    const count = db.prepare('SELECT COUNT(*) AS n FROM votes WHERE target_type = ? AND target_id = ?')
      .get(type, id).n;
    return ok(res, { voted: !has, count });
  }

  if (path === '/api/bookmark' && method === 'POST') {
    const u = needAuth();
    const postId = body.postId;
    if (!getPostRow(postId)) return fail(res, 404, 'not_found', '这层楼不在了');
    const has = db.prepare('SELECT 1 AS x FROM bookmarks WHERE user_id = ? AND post_id = ?').get(u.id, postId);
    if (has) db.prepare('DELETE FROM bookmarks WHERE user_id = ? AND post_id = ?').run(u.id, postId);
    else db.prepare('INSERT INTO bookmarks (user_id, post_id, created_at) VALUES (?, ?, ?)').run(u.id, postId, now());
    return ok(res, { bookmarked: !has });
  }

  if (path === '/api/follow' && method === 'POST') {
    const u = needAuth();
    const target = body.userId;
    if (target === u.id) throw bad('不能关注自己');
    if (!getUserRow(target)) return fail(res, 404, 'not_found', '这条鱼不在了');
    const has = db.prepare('SELECT 1 AS x FROM follows WHERE follower_id = ? AND followee_id = ?')
      .get(u.id, target);
    if (has) db.prepare('DELETE FROM follows WHERE follower_id = ? AND followee_id = ?').run(u.id, target);
    else {
      db.prepare('INSERT INTO follows (follower_id, followee_id, created_at) VALUES (?, ?, ?)')
        .run(u.id, target, now());
      notify(target, 'follow', u.id, null, null, '开始追你的鱼');
    }
    return ok(res, { following: !has });
  }

  if (path === '/api/pond/join' && method === 'POST') {
    const u = needAuth();
    const has = db.prepare('SELECT 1 AS x FROM pond_members WHERE user_id = ?').get(u.id);
    if (has) db.prepare('DELETE FROM pond_members WHERE user_id = ?').run(u.id);
    else {
      db.prepare('INSERT INTO pond_members (user_id, created_at) VALUES (?, ?)').run(u.id, now());
      const mods = db.prepare("SELECT id FROM users WHERE role IN ('mod','admin')").all();
      for (const row of mods) notify(row.id, 'pond', u.id, null, null, '进塘了');
    }
    return ok(res, { inPond: !has, stats: stats() });
  }

  /* ---- 列表：鱼篓 / 关注 ---- */
  if (path === '/api/basket' && method === 'GET') {
    const u = needAuth();
    return ok(res, listPosts({ meId: u.id, onlyBookmarked: true, sort: 'new', page: q.get('page') }));
  }

  if (path === '/api/following' && method === 'GET') {
    const u = needAuth();
    return ok(res, listPosts({ meId: u.id, onlyFollowing: true, sort: 'fat', page: q.get('page') }));
  }

  /* ---- 用户 ---- */
  m = path.match(/^\/api\/users\/([\w-]+)$/);
  if (m && method === 'GET') {
    const row = getUserRow(m[1]);
    if (!row) return fail(res, 404, 'not_found', '这条鱼不在了');
    const posts = db.prepare('SELECT COUNT(*) AS n FROM posts WHERE author_id = ? AND deleted = 0').get(row.id).n;
    const floors = db.prepare('SELECT COUNT(*) AS n FROM floors WHERE author_id = ? AND deleted = 0').get(row.id).n;
    const food = db.prepare(
      `SELECT COUNT(*) AS n FROM votes v
       WHERE (v.target_type = 'post' AND v.target_id IN (SELECT id FROM posts WHERE author_id = ?))
          OR (v.target_type = 'floor' AND v.target_id IN (SELECT id FROM floors WHERE author_id = ?))
          OR (v.target_type = 'reply' AND v.target_id IN (SELECT id FROM replies WHERE author_id = ?))`
    ).get(row.id, row.id, row.id).n;
    const followers = db.prepare('SELECT COUNT(*) AS n FROM follows WHERE followee_id = ?').get(row.id).n;

    return ok(res, {
      user: { ...auth.publicUser(row), posts, floors, food, followers },
      isMe: meId === row.id,
      following: meId
        ? !!db.prepare('SELECT 1 AS x FROM follows WHERE follower_id = ? AND followee_id = ?').get(meId, row.id)
        : false,
      posts: listPosts({ meId, authorId: row.id, sort: 'new', page: q.get('page') })
    });
  }

  /* ---- 通知 ---- */
  if (path === '/api/notifications' && method === 'GET') {
    const u = needAuth();
    const rows = db.prepare(
      'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 40'
    ).all(u.id);
    return ok(res, {
      items: rows.map((r) => ({
        id: r.id,
        type: r.type,
        text: r.text,
        postId: r.post_id,
        read: !!r.read,
        createdAt: r.created_at,
        actor: r.actor_id ? briefUser(r.actor_id) : null
      })),
      unread: rows.filter((r) => !r.read).length
    });
  }

  if (path === '/api/notifications/read' && method === 'POST') {
    const u = needAuth();
    db.prepare('UPDATE notifications SET read = 1 WHERE user_id = ?').run(u.id);
    return ok(res, { ok: true });
  }

  /* ---- 鱼汛（实时聊天） ---- */
  if (path === '/api/chat/stream' && method === 'GET') {
    const r = chat.attach(req, res, ctx.ip, me);
    if (r.error === 'chat_full') {
      return fail(res, 503, 'chat_full', '鱼汛里人太多了，等会儿再进来');
    }
    if (r.error === 'too_many_windows') {
      return fail(res, 429, 'too_many_windows', '同一个账号开的窗口太多了，关掉几个再试');
    }
    if (r.error === 'too_many_connections') {
      return fail(res, 429, 'too_many_connections', '这个网络连进来的窗口太多了，等会儿再试');
    }
    // 响应已经交给 SSE 流，这里不能再写任何东西
    return;
  }

  if (path === '/api/chat/messages' && method === 'GET') {
    return ok(res, chatHistory({
      limit: q.get('limit'),
      before: Number(q.get('before')),
      after: Number(q.get('after'))
    }));
  }

  if (path === '/api/chat/messages' && method === 'POST') {
    const u = needAuth();
    if (!rateLimit('chat:' + u.id, 12, 30 * 1000)) {
      return fail(res, 429, 'rate_limited', '说太快了，缓一口气');
    }
    const text = str(body.body, LIMITS.chat);
    if (!text) throw bad('空着发不出去');

    const id = uid('m');
    const t = now();
    db.prepare('INSERT INTO chat_messages (id, user_id, body, deleted, created_at) VALUES (?, ?, ?, 0, ?)')
      .run(id, u.id, text, t);

    const message = { id, body: text, createdAt: t, author: briefUser(u.id) };
    chat.broadcast('msg', message);
    return ok(res, { message });
  }

  if (path === '/api/mod/chat' && method === 'POST') {
    needMod();
    const row = db.prepare('SELECT * FROM chat_messages WHERE id = ? AND deleted = 0').get(body.messageId);
    if (!row) return fail(res, 404, 'not_found', '这条消息不在了');
    db.prepare('UPDATE chat_messages SET deleted = 1 WHERE id = ?').run(row.id);
    chat.broadcast('del', { id: row.id });
    return ok(res, { deleted: true });
  }

  /* ---- 举报 ---- */
  if (path === '/api/report' && method === 'POST') {
    const u = needAuth();
    const type = body.targetType;
    if (!['post', 'floor', 'reply'].includes(type)) throw bad('未知的举报对象');
    const reason = str(body.reason, LIMITS.reason);
    if (reason.length < 2) throw bad('写一句理由吧');
    db.prepare(
      'INSERT INTO reports (id, target_type, target_id, reporter_id, reason, resolved, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)'
    ).run(uid('rep'), type, body.targetId, u.id, reason, now());
    return ok(res, { ok: true });
  }

  /* ---- 版务 ---- */
  if (path === '/api/mod/post' && method === 'POST') {
    needMod();
    const row = getPostRow(body.postId);
    if (!row) return fail(res, 404, 'not_found', '这层楼不在了');
    if (typeof body.pinned === 'boolean') {
      db.prepare('UPDATE posts SET pinned = ? WHERE id = ?').run(body.pinned ? 1 : 0, row.id);
    }
    if (typeof body.locked === 'boolean') {
      db.prepare('UPDATE posts SET locked = ? WHERE id = ?').run(body.locked ? 1 : 0, row.id);
    }
    if (body.deleted === true) {
      db.prepare('UPDATE posts SET deleted = 1 WHERE id = ?').run(row.id);
      return ok(res, { deleted: true });
    }
    return ok(res, { post: fullPost(getPostRow(row.id), null) });
  }

  if (path === '/api/mod/content' && method === 'POST') {
    needMod();
    const type = body.targetType;
    if (type === 'floor') {
      db.prepare('UPDATE floors SET deleted = 1 WHERE id = ?').run(body.targetId);
    } else if (type === 'reply') {
      db.prepare('UPDATE replies SET deleted = 1 WHERE id = ?').run(body.targetId);
    } else {
      throw bad('未知的类型');
    }
    return ok(res, { deleted: true });
  }

  if (path === '/api/mod/reports' && method === 'GET') {
    needMod();
    const rows = db.prepare('SELECT * FROM reports WHERE resolved = 0 ORDER BY created_at DESC LIMIT 50').all();
    return ok(res, {
      items: rows.map((r) => ({
        id: r.id,
        targetType: r.target_type,
        targetId: r.target_id,
        reason: r.reason,
        createdAt: r.created_at,
        reporter: briefUser(r.reporter_id)
      }))
    });
  }

  if (path === '/api/mod/report/resolve' && method === 'POST') {
    needMod();
    db.prepare('UPDATE reports SET resolved = 1 WHERE id = ?').run(body.reportId);
    return ok(res, { ok: true });
  }

  return fail(res, 404, 'no_route', '接口不存在');
}

module.exports = { handle };
