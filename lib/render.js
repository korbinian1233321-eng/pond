'use strict';

/**
 * Pond · 服务端渲染
 *
 * 前端是单页应用，HTML 本身是个空壳：所有内容都在浏览器里现渲染。
 * 结果是爬虫抓到的是一片空白，搜「任何一楼的具体内容」都搜不到。
 *
 * 这里做的事：在服务端把每一页的正文先渲染一遍，塞进 index.html 的 <main>，
 * 顺便补上 title / description / canonical / OG / JSON-LD。
 * 浏览器跑起 app.js 之后会把它整个换成可交互的版本。
 *
 * 不追求和前端渲染逐像素一致——只要内容完整、语义正确、样式不难看。
 * 所有用户内容一律走 esc()，和前端用的是同一套转义规则。
 */

const fs = require('node:fs');
const path = require('node:path');
const { db, parseTags } = require('./db');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const SHELL_FILE = path.join(PUBLIC_DIR, 'index.html');

/* ---------- 骨架 ---------- */

const MAIN_RE = /<main id="main"[^>]*><\/main>/;
const TAGLIST_RE = /<div class="tag-list" id="tagList"><\/div>/;
const TITLE_RE = /<title>[^<]*<\/title>/;
const DESC_RE = /<meta name="description"[^>]*>/;

const shellCache = { mtime: 0, html: '' };

/** 读 index.html。改了文件不用重启，按 mtime 重新读。 */
function shell() {
  const st = fs.statSync(SHELL_FILE);
  if (shellCache.mtime !== st.mtimeMs) {
    const html = fs.readFileSync(SHELL_FILE, 'utf8');
    if (!MAIN_RE.test(html)) {
      throw new Error('public/index.html 里找不到空的 <main id="main"></main>，服务端渲染没法注入内容');
    }
    shellCache.mtime = st.mtimeMs;
    shellCache.html = html;
  }
  return shellCache.html;
}

/* ---------- 转义 / 格式 ---------- */

const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ESC_MAP[c]);
}

/** 只认站内上传的图。外链图片既是隐私问题（第三方能拿到读者 IP），也活不长。 */
const IMG_RE = /!\[([^\]]{0,120})\]\((\/uploads\/f_[a-z0-9]+\.(?:png|jpg|gif|webp))\)/g;

/** 带上真实宽高，浏览器能提前留出位置，图加载完页面不会跳 */
function imgTag(alt, src) {
  const id = src.slice('/uploads/'.length).replace(/\.[a-z]+$/, '');
  let wh = '';
  try {
    const row = db.prepare('SELECT width, height FROM uploads WHERE id = ?').get(id);
    if (row && row.width && row.height) wh = ` width="${row.width}" height="${row.height}"`;
  } catch { /* 表还没建好的极端情况，不耽误渲染 */ }
  return `<img class="post-img" src="${src}" alt="${alt}"${wh} loading="lazy" decoding="async">`;
}

/** 和前端 formatBody 同一套：空行分段、`code`、**粗**、站内图、裸链接 */
function md(text) {
  return String(text == null ? '' : text).split(/\n{2,}/).map((p) => {
    const t = esc(p)
      .replace(/`([^`]+)`/g, '<span class="code">$1</span>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(IMG_RE, (m, alt, src) => imgTag(alt, src))
      .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" rel="nofollow noopener">$1</a>');
    return '<p>' + t.replace(/\n/g, '<br>') + '</p>';
  }).join('');
}

function cut(t, n) {
  const s = String(t == null ? '' : t).replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n) + '…' : s;
}

/** 摘要里别留 ** 和 ` 这些标记，也别把图片地址塞进 description */
function plain(text) {
  return String(text == null ? '' : text)
    .replace(IMG_RE, ' [图] ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function isoOf(ts) {
  const d = new Date(ts);
  return Number.isFinite(d.getTime()) ? d.toISOString() : '';
}

function relTime(ts) {
  const m = Math.floor((Date.now() - ts) / 60000);
  if (m < 1) return '刚刚';
  if (m < 60) return m + ' 分钟前';
  const h = Math.floor(m / 60);
  if (h < 24) return h + ' 小时前';
  const d = Math.floor(h / 24);
  if (d < 30) return d + ' 天前';
  const dt = new Date(ts);
  return (dt.getMonth() + 1) + ' 月 ' + dt.getDate() + ' 日';
}

function hueOf(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 360;
  return h;
}

function initials(name, size) {
  const t = String(name || '?').trim();
  if (/[\u4e00-\u9fa5]/.test(t)) return size >= 44 ? t.slice(0, 2) : t.slice(0, 1);
  const p = t.split(/\s+/);
  if (p.length > 1) return (p[0][0] + p[1][0]).toUpperCase();
  return t.slice(0, 2).toUpperCase();
}

function avatarHTML(user, size) {
  const s = size || 38;
  const key = (user && (user.id + (user.fishName || user.username))) || 'x';
  const h = hueOf(key);
  const style = 'width:' + s + 'px;height:' + s + 'px;font-size:' + Math.round(s * 0.4) +
    'px;line-height:1;letter-spacing:0;background:linear-gradient(135deg,hsl(' + h +
    ' 66% 62%),hsl(' + ((h + 32) % 360) + ' 70% 45%))';
  const name = (user && (user.fishName || user.username)) || '?';
  return '<span class="avatar" style="' + style + '">' + esc(initials(name, s)) + '</span>';
}

/* ---------- 数据 ---------- */

const stmts = new Map();
function q(sql) {
  let s = stmts.get(sql);
  if (!s) { s = db.prepare(sql); stmts.set(sql, s); }
  return s;
}

function brief(id) {
  const u = q('SELECT id, username, fish_name, fish_type, bio, role FROM users WHERE id = ?').get(id);
  if (!u) return { id, username: '', fishName: '已注销的鱼', fishType: '', bio: '', role: 'member' };
  return {
    id: u.id,
    username: u.username,
    fishName: u.fish_name,
    fishType: u.fish_type,
    bio: u.bio || '',
    role: u.role
  };
}

function summaryOf(row) {
  const floors = q('SELECT COUNT(*) AS n FROM floors WHERE post_id = ? AND deleted = 0').get(row.id).n;
  const replies = q('SELECT COUNT(*) AS n FROM replies WHERE post_id = ? AND deleted = 0').get(row.id).n;
  const food = q("SELECT COUNT(*) AS n FROM votes WHERE target_type = 'post' AND target_id = ?").get(row.id).n;
  const last = q(
    `SELECT MAX(ts) AS t FROM (
       SELECT created_at AS ts FROM floors WHERE post_id = ? AND deleted = 0
       UNION ALL
       SELECT created_at AS ts FROM replies WHERE post_id = ? AND deleted = 0
     )`
  ).get(row.id, row.id).t;
  return {
    id: row.id,
    title: row.title,
    quote: row.quote || '',
    body: row.body || '',
    tags: parseTags(row.tags),
    author: brief(row.author_id),
    pinned: !!row.pinned,
    locked: !!row.locked,
    createdAt: row.created_at,
    lastAt: Math.max(row.created_at, last || 0),
    floors,
    replies,
    food
  };
}

function listRows(opts) {
  const o = opts || {};
  const where = ['p.deleted = 0'];
  const params = [];
  if (o.tag) {
    where.push('p.tags LIKE ?');
    params.push('%"' + String(o.tag).replace(/[%_"]/g, '') + '"%');
  }
  if (o.authorId) {
    where.push('p.author_id = ?');
    params.push(o.authorId);
  }
  const limit = Math.min(Math.max(parseInt(o.limit, 10) || 20, 1), 50);
  const rows = q(
    `SELECT p.* FROM posts p WHERE ${where.join(' AND ')}
     ORDER BY p.pinned DESC, p.created_at DESC LIMIT ${limit}`
  ).all(...params);
  return rows.map(summaryOf);
}

function tagCounts(allowed) {
  const list = Array.isArray(allowed) ? allowed : [];
  const m = new Map(list.map((t) => [t, 0]));
  for (const r of q('SELECT tags FROM posts WHERE deleted = 0').all()) {
    for (const t of parseTags(r.tags)) m.set(t, (m.get(t) || 0) + 1);
  }
  return Array.from(m, ([name, count]) => ({ name, count }));
}

function siteStats() {
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  return {
    posts: q('SELECT COUNT(*) AS n FROM posts WHERE deleted = 0').get().n,
    floors: q('SELECT COUNT(*) AS n FROM floors WHERE deleted = 0').get().n,
    replies: q('SELECT COUNT(*) AS n FROM replies WHERE deleted = 0').get().n,
    members: q('SELECT COUNT(*) AS n FROM pond_members').get().n,
    recent: q('SELECT COUNT(*) AS n FROM posts WHERE deleted = 0 AND created_at >= ?')
      .get(Date.now() - 24 * 3600 * 1000).n
  };
}

/* ---------- 片段 ---------- */

function threadHTML(p) {
  const tags = p.tags.map((t) => '<i>' + esc(t) + '</i>').join('');
  return '<a class="thread' + (p.pinned ? ' pinned' : '') + '" href="/p/' + encodeURIComponent(p.id) + '">' +
    avatarHTML(p.author, 38) +
    '<span class="thread-main">' +
    '<span class="thread-title">' + (p.pinned ? '<span class="pin-badge">置顶</span>' : '') + esc(p.title) + '</span>' +
    (p.quote ? '<span class="thread-quote">' + esc(cut(p.quote, 60)) + '</span>' : '') +
    '<span class="thread-meta">' +
    '<span class="who">' + esc(p.author.fishName) + '</span>' +
    '<span class="dot">·</span><time datetime="' + isoOf(p.createdAt) + '">' + relTime(p.createdAt) + '</time>' +
    '<span class="dot">·</span><span class="thread-tags">' + tags + '</span>' +
    '</span></span>' +
    '<span class="thread-side">' +
    '<span class="thread-replies">' + (p.floors + p.replies) + '</span>' +
    '<span class="thread-food">' + p.food + '</span>' +
    '<span class="thread-last">最后 ' + relTime(p.lastAt) + '</span>' +
    '</span></a>';
}

function threadListHTML(items, emptyTitle, emptySub) {
  if (!items.length) {
    return '<div class="empty"><h3>' + esc(emptyTitle || '这里还没有楼') + '</h3><p>' +
      esc(emptySub || '换个塘口看看，或者自己开一层。') + '</p></div>';
  }
  return '<div class="floor-list">' + items.map(threadHTML).join('') + '</div>';
}

function tagLinksHTML(tags) {
  return tags.map((t) =>
    '<i><a href="/t/' + encodeURIComponent(t) + '">' + esc(t) + '</a></i>'
  ).join('');
}

function authorLinkHTML(u) {
  return '<a href="/u/' + encodeURIComponent(u.id) + '">' + esc(u.fishName) + '</a>';
}

function fishSayHTML(p) {
  if (!p.quote) return '';
  return '<div class="fish-say"><span class="q-mark">「</span>' + esc(p.quote) +
    '<span class="q-mark">」</span><span class="who">—— ' + esc(p.author.fishName) + '</span></div>';
}

/* ---------- 页面外壳 ---------- */

function pageHTML(opts) {
  let html = shell();
  const canonical = opts.baseUrl + opts.path;

  html = html.replace(TITLE_RE, '<title>' + esc(opts.title) + '</title>');
  html = html.replace(DESC_RE, '<meta name="description" content="' + esc(opts.desc) + '" />');

  const head = [
    '<link rel="canonical" href="' + esc(canonical) + '" />',
    '<meta property="og:site_name" content="' + esc(opts.siteName) + '" />',
    '<meta property="og:type" content="' + esc(opts.ogType || 'website') + '" />',
    '<meta property="og:title" content="' + esc(opts.title) + '" />',
    '<meta property="og:description" content="' + esc(opts.desc) + '" />',
    '<meta property="og:url" content="' + esc(canonical) + '" />',
    '<meta name="twitter:card" content="summary" />'
  ];
  if (opts.jsonld) {
    // </script> 会提前闭合脚本块，转义掉 <
    head.push('<script type="application/ld+json">' +
      JSON.stringify(opts.jsonld).replace(/</g, '\\u003c') + '</script>');
  }
  html = html.replace('</head>', head.join('\n') + '\n</head>');

  html = html.replace(MAIN_RE, (m) => m.replace('</main>', opts.body + '</main>'));

  if (TAGLIST_RE.test(html)) {
    const chips = opts.tags.map((t) =>
      '<a class="tag-chip" href="/t/' + encodeURIComponent(t.name) + '">' +
      esc(t.name) + (t.count ? ' ' + t.count : '') + '</a>'
    ).join('');
    html = html.replace(TAGLIST_RE, '<div class="tag-list" id="tagList">' + chips + '</div>');
  }

  return { status: opts.status || 200, html };
}

/* ---------- 首页 ---------- */

function homePage(config, baseUrl) {
  const st = siteStats();
  const tags = tagCounts(config.tags);
  const items = listRows({ limit: 20 });

  let body = '<section class="pond-head"><div class="pond-inner">' +
    '<div class="pond-top"><div>' +
    '<div class="pond-title">' + esc(config.name) +
    '<span>' + esc(config.slug) + ' · ' + esc(config.tagline) + '</span></div>' +
    '<div class="pond-desc">' + esc(config.desc) + '</div>' +
    '</div></div>' +
    '<div class="pond-stats">' +
    '<div class="pond-stat"><b>' + st.recent + '</b><span>近 24 小时</span></div>' +
    '<div class="pond-stat"><b>' + st.posts + '</b><span>主题</span></div>' +
    '<div class="pond-stat"><b>' + (st.floors + st.replies) + '</b><span>楼层</span></div>' +
    '<div class="pond-stat"><b>' + st.members + '</b><span>养鱼人</span></div>' +
    '</div></div></section>';

  body += '<h2 class="ssr-h2">最近开的楼<span>共 ' + st.posts + ' 层</span></h2>';
  body += threadListHTML(items, '塘里还没有楼', '这是第一个塘，第一层楼还空着。');

  if (config.rules.length) {
    body += '<div class="ssr-note"><strong>塘规</strong><br>' +
      config.rules.map(esc).join('<br>') + '</div>';
  }
  body += '<div class="ssr-note">投喂 = 点赞 · 鱼篓 = 收藏 · 追鱼 = 关注 · 鱼汛 = 实时聊天</div>';

  return pageHTML({
    config,
    baseUrl,
    path: '/',
    siteName: config.name,
    title: config.name + (config.tagline ? ' · ' + config.tagline : ''),
    desc: cut(plain(config.desc || config.tagline || config.name), 150),
    tags,
    body,
    jsonld: {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: config.name,
      alternateName: config.slug,
      description: config.desc,
      url: baseUrl + '/'
    }
  });
}

/* ---------- 塘口（标签）页 ---------- */

function tagPage(tag, config, baseUrl, pathname) {
  const tags = tagCounts(config.tags);
  const known = tags.find((t) => t.name === tag);
  const items = listRows({ tag, limit: 40 });

  if (!known && !items.length) {
    return notFound(config, baseUrl, pathname, '没有这个塘口',
      '塘口列表在侧栏，也可能是这个塘口还没人发过楼。');
  }

  let body = '<div class="page-head"><h1>塘口「' + esc(tag) + '」</h1>' +
    '<p>' + (items.length ? '最近 ' + items.length + ' 层楼' : '还没有人在这里开楼') + '</p></div>';
  body += threadListHTML(items, '这个塘口还是空的', '第一层楼等着人开。');
  body += '<div class="ssr-note"><a href="/">← 回塘首页</a></div>';

  return pageHTML({
    config,
    baseUrl,
    path: pathname,
    siteName: config.name,
    title: '塘口「' + tag + '」· ' + config.name,
    desc: cut(config.name + ' 里「' + tag + '」塘口下的 ' + items.length + ' 层楼：' +
      items.map((p) => p.title).join('、'), 150),
    tags,
    body
  });
}

/* ---------- 楼层页 ---------- */

function postPage(id, config, baseUrl, pathname) {
  const row = q('SELECT * FROM posts WHERE id = ? AND deleted = 0').get(id);
  if (!row) {
    return notFound(config, baseUrl, pathname, '这层楼不在了', '可能被楼主自己拆了，或者版主删了。');
  }

  const p = summaryOf(row);
  const op = p.author;
  const tags = tagCounts(config.tags);

  const floorRows = q('SELECT * FROM floors WHERE post_id = ? AND deleted = 0 ORDER BY created_at ASC').all(p.id);
  const floorIds = floorRows.map((f) => f.id);
  let replyRows = [];
  if (floorIds.length) {
    const ph = floorIds.map(() => '?').join(',');
    replyRows = q(
      `SELECT * FROM replies WHERE floor_id IN (${ph}) AND deleted = 0 ORDER BY created_at ASC`
    ).all(...floorIds);
  }
  const repliesOf = new Map();
  for (const r of replyRows) {
    if (!repliesOf.has(r.floor_id)) repliesOf.set(r.floor_id, []);
    repliesOf.get(r.floor_id).push(r);
  }

  let body = '<nav class="ssr-crumbs"><a href="/">← 回塘首页</a></nav>';
  body += '<div class="thread-view"><div class="post-shell">';

  body += '<div class="post-shell-head"><div class="post-tagrow">' +
    (p.pinned ? '<i style="background:#fff4dc;color:#b97b10">置顶</i>' : '') +
    tagLinksHTML(p.tags) + '</div>' +
    '<h1 class="post-h1">' + esc(p.title) + '</h1>' +
    (p.locked ? '<div class="locked-banner">这层楼已经锁了，只能看，不能回。</div>' : '') +
    '</div>';

  body += '<div class="floors">';

  // 1 楼 = 楼主
  body += '<article class="floor" id="floor-op">' + avatarHTML(op, 42) + '<div>' +
    '<div class="floor-head">' +
    '<span class="floor-name">' + authorLinkHTML(op) +
    '<span class="badge-op">楼主</span><span class="fn-sub">' + esc(op.fishType) + '</span></span>' +
    '<span class="floor-num">1 楼</span>' +
    '<time class="floor-time" datetime="' + isoOf(p.createdAt) + '">' + relTime(p.createdAt) + '</time>' +
    '</div>' +
    '<div class="floor-body">' + md(p.body) + '</div>' +
    fishSayHTML(p) +
    '</div></article>';

  floorRows.forEach((f, i) => {
    const a = brief(f.author_id);
    const subs = repliesOf.get(f.id) || [];
    body += '<article class="floor" id="floor-' + esc(f.id) + '">' + avatarHTML(a, 42) + '<div>' +
      '<div class="floor-head">' +
      '<span class="floor-name">' + authorLinkHTML(a) +
      (f.author_id === row.author_id ? '<span class="badge-op">楼主</span>' : '') +
      '<span class="fn-sub">' + esc(a.fishType) + '</span></span>' +
      '<span class="floor-num">' + (i + 2) + ' 楼</span>' +
      '<time class="floor-time" datetime="' + isoOf(f.created_at) + '">' + relTime(f.created_at) + '</time>' +
      '</div>' +
      '<div class="floor-body">' + md(f.body) + '</div>' +
      subs.map((r) => {
        const ra = brief(r.author_id);
        return '<div class="sub-item"><div class="sub-head">' + avatarHTML(ra, 20) +
          '<span class="sub-name">' + esc(ra.fishName) + '</span>' +
          '<time class="sub-time" datetime="' + isoOf(r.created_at) + '">' + relTime(r.created_at) + '</time></div>' +
          '<div class="sub-body">' + md(r.body) + '</div></div>';
      }).join('') +
      '</div></article>';
  });

  body += '</div></div></div>';
  body += '<div class="ssr-note">共 ' + (floorRows.length + 1) + ' 层，' +
    (p.food ? p.food + ' 把鱼粮，' : '') +
    '最后更新于 <time datetime="' + isoOf(p.lastAt) + '">' + relTime(p.lastAt) + '</time></div>';

  const desc = cut(plain(p.body || p.title), 150);

  return pageHTML({
    config,
    baseUrl,
    path: pathname,
    siteName: config.name,
    title: p.title + ' · ' + config.name,
    desc,
    ogType: 'article',
    tags,
    body,
    jsonld: {
      '@context': 'https://schema.org',
      '@type': 'DiscussionForumPosting',
      headline: p.title,
      text: cut(plain(p.body), 500),
      url: baseUrl + pathname,
      datePublished: isoOf(p.createdAt),
      dateModified: isoOf(p.lastAt),
      inLanguage: 'zh-CN',
      author: {
        '@type': 'Person',
        name: op.fishName,
        alternateName: op.username,
        url: baseUrl + '/u/' + encodeURIComponent(op.id)
      },
      keywords: p.tags.join(','),
      commentCount: floorRows.length + replyRows.length,
      interactionStatistic: {
        '@type': 'InteractionCounter',
        interactionType: 'https://schema.org/LikeAction',
        userInteractionCount: p.food
      }
    }
  });
}

/* ---------- 鱼档（用户）页 ---------- */

function userPage(id, config, baseUrl, pathname) {
  const u = q('SELECT * FROM users WHERE id = ?').get(id);
  if (!u) {
    return notFound(config, baseUrl, pathname, '找不到这条鱼', '可能注销了，或者链接贴错了。');
  }

  const tags = tagCounts(config.tags);
  const posts = q('SELECT COUNT(*) AS n FROM posts WHERE author_id = ? AND deleted = 0').get(u.id).n;
  const floors = q('SELECT COUNT(*) AS n FROM floors WHERE author_id = ? AND deleted = 0').get(u.id).n;
  const followers = q('SELECT COUNT(*) AS n FROM follows WHERE followee_id = ?').get(u.id).n;
  const items = listRows({ authorId: u.id, limit: 20 });
  const me = brief(u.id);

  let body = '<nav class="ssr-crumbs"><a href="/">← 回塘首页</a></nav>';
  body += '<div class="profile-head">' + avatarHTML(me, 62) +
    '<div class="profile-main">' +
    '<div class="profile-name">' + esc(me.fishName) + '</div>' +
    '<div class="profile-fish">' + esc(me.username) + ' · ' + esc(me.fishType) +
    (u.role !== 'member' ? ' · ' + (u.role === 'admin' ? '管理员' : '版主') : '') + '</div>' +
    '<div class="profile-bio">' + esc(me.bio || '这条鱼还没写简介。') + '</div>' +
    '<div class="profile-stats">' +
    '<div><b>' + posts + '</b>开的楼</div>' +
    '<div><b>' + floors + '</b>盖的层</div>' +
    '<div><b>' + followers + '</b>被追</div>' +
    '</div></div></div>';

  body += '<h2 class="ssr-h2">' + esc(me.fishName) + ' 开的楼<span>共 ' + posts + ' 层</span></h2>';
  body += threadListHTML(items, '还没开过楼', '这条鱼只在别人的楼里冒泡。');

  return pageHTML({
    config,
    baseUrl,
    path: pathname,
    siteName: config.name,
    title: me.fishName + ' · ' + config.name,
    desc: cut((me.bio ? me.bio + ' —— ' : '') + me.fishName + ' 在' + config.name +
      '开了 ' + posts + ' 层楼、盖了 ' + floors + ' 层', 150),
    tags,
    body,
    jsonld: {
      '@context': 'https://schema.org',
      '@type': 'ProfilePage',
      url: baseUrl + pathname,
      mainEntity: {
        '@type': 'Person',
        name: me.fishName,
        alternateName: me.username,
        description: me.bio || undefined,
        url: baseUrl + pathname
      }
    }
  });
}

/* ---------- 404 ---------- */

function notFound(config, baseUrl, pathname, title, sub) {
  const tags = tagCounts(config.tags);
  const body = '<div class="empty"><h3>' + esc(title) + '</h3><p>' + esc(sub || '') + '</p>' +
    '<p style="margin-top:14px"><a href="/" style="color:var(--accent)">← 回塘首页</a></p></div>';
  const page = pageHTML({
    config,
    baseUrl,
    path: pathname,
    siteName: config.name,
    title: title + ' · ' + config.name,
    desc: sub || title,
    tags,
    body,
    status: 404
  });
  page.noindex = true;
  return page;
}

/* ---------- 路由 ---------- */

/**
 * 认领这几种路径，其余返回 null 交给静态资源/单页回退。
 * 注意：不认 /api/、/chat、/basket、/following —— 那些要么是接口，要么必须登录。
 */
function renderRoute(pathname, config, baseUrl) {
  const clean = String(pathname || '/').replace(/\/+$/, '') || '/';
  if (clean === '/') return homePage(config, baseUrl);

  const m = clean.match(/^\/(p|u|t)\/([^/]+)$/);
  if (!m) return null;

  let key;
  try {
    key = decodeURIComponent(m[2]);
  } catch {
    return null;
  }
  if (!key || key.length > 64) return null;

  if (m[1] === 't') {
    if (key.length > 40) return null;
    return tagPage(key, config, baseUrl, clean);
  }
  if (!/^[\w-]+$/.test(key)) return null;
  if (m[1] === 'p') return postPage(key, config, baseUrl, clean);
  return userPage(key, config, baseUrl, clean);
}

/* ---------- sitemap / robots ---------- */

function sitemapXML(baseUrl) {
  const urls = [];
  const day = (ts) => new Date(ts).toISOString().slice(0, 10);

  const newest = q('SELECT MAX(created_at) AS t FROM posts WHERE deleted = 0').get().t;
  urls.push({ loc: baseUrl + '/', lastmod: day(newest || Date.now()), priority: '1.0', freq: 'hourly' });

  for (const t of q('SELECT tags FROM posts WHERE deleted = 0').all()) {
    for (const tag of parseTags(t.tags)) {
      urls.push({ loc: baseUrl + '/t/' + encodeURIComponent(tag), priority: '0.6', freq: 'daily' });
    }
  }

  for (const p of q('SELECT id, created_at FROM posts WHERE deleted = 0 ORDER BY created_at DESC LIMIT 2000').all()) {
    urls.push({
      loc: baseUrl + '/p/' + encodeURIComponent(p.id),
      lastmod: day(p.created_at),
      priority: '0.8',
      freq: 'weekly'
    });
  }

  for (const u of q('SELECT id, created_at FROM users ORDER BY created_at DESC LIMIT 1000').all()) {
    urls.push({
      loc: baseUrl + '/u/' + encodeURIComponent(u.id),
      lastmod: day(u.created_at),
      priority: '0.4',
      freq: 'weekly'
    });
  }

  // 同一个 URL 只留一条（多个楼共用一个塘口时会出现重复）
  const seen = new Set();
  const rows = urls.filter((u) => (seen.has(u.loc) ? false : (seen.add(u.loc), true))).map((u) =>
    '<url><loc>' + esc(u.loc) + '</loc>' +
    (u.lastmod ? '<lastmod>' + u.lastmod + '</lastmod>' : '') +
    (u.freq ? '<changefreq>' + u.freq + '</changefreq>' : '') +
    '<priority>' + u.priority + '</priority></url>'
  );

  return '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    rows.join('\n') + '\n</urlset>\n';
}

function robotsTXT(baseUrl) {
  return [
    'User-agent: *',
    'Allow: /',
    'Disallow: /api/',
    'Disallow: /chat',
    'Disallow: /basket',
    'Disallow: /following',
    '',
    'Sitemap: ' + baseUrl + '/sitemap.xml',
    ''
  ].join('\n');
}

module.exports = { renderRoute, sitemapXML, robotsTXT };
