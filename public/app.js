/* ===== Pond · 前端 ===== */
(function () {
  'use strict';

  var API = '/api';

  /* ---------- 状态 ---------- */
  var S = {
    config: { name: '大肥鱼塘', tagline: '', desc: '', rules: [], tags: [] },
    me: null,
    tags: [],
    stats: null,
    view: 'home',
    postId: null,
    userId: null,
    tag: null,
    q: '',
    sort: 'fat',
    page: 1,
    list: null,
    post: null,
    user: null,
    expanded: {},
    replying: null,
    onlyOP: false,
    notif: null,
    loading: false,
    draftTags: [],
    // 鱼汛：msgs 只在内存里滚动，进页面时从服务端拉最近 60 条
    chat: {
      msgs: [],
      online: [],
      es: null,
      loaded: false,
      live: false,
      sending: false,
      pending: 0
    },
    chatOnline: 0
  };

  /* ---------- 工具 ---------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function timeAgo(ts) {
    var m = Math.floor((Date.now() - ts) / 60000);
    if (m < 1) return '刚刚';
    if (m < 60) return m + ' 分钟前';
    var h = Math.floor(m / 60);
    if (h < 24) return h + ' 小时前';
    var d = Math.floor(h / 24);
    if (d < 30) return d + ' 天前';
    var dt = new Date(ts);
    return (dt.getMonth() + 1) + ' 月 ' + dt.getDate() + ' 日';
  }
  function hueOf(str) {
    var h = 0;
    for (var i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 360;
    return h;
  }
  function initials(name, size) {
    var t = String(name || '?').trim();
    // 中文取首字：女仆鲸 / 数据鲸 / 早起鲸 如果取末字会全变成「鲸」
    if (/[\u4e00-\u9fa5]/.test(t)) return size && size >= 44 ? t.slice(0, 2) : t.slice(0, 1);
    var p = t.split(/\s+/);
    if (p.length > 1) return (p[0][0] + p[1][0]).toUpperCase();
    return t.slice(0, 2).toUpperCase();
  }
  function avatarHTML(user, size) {
    var s = size || 38;
    var key = (user && (user.id + (user.fishName || user.username))) || 'x';
    var h = hueOf(key);
    var style = 'width:' + s + 'px;height:' + s + 'px;font-size:' + Math.round(s * 0.4) +
      'px;line-height:1;letter-spacing:0;background:linear-gradient(135deg,hsl(' + h +
      ' 66% 62%),hsl(' + ((h + 32) % 360) + ' 70% 45%))';
    var name = (user && (user.fishName || user.username)) || '?';
    return '<span class="avatar" style="' + style + '">' + esc(initials(name, s)) + '</span>';
  }
  function cut(t, n) {
    var s = String(t || '').replace(/\s+/g, ' ').trim();
    return s.length > n ? s.slice(0, n) + '…' : s;
  }
  function formatBody(text) {
    return String(text).split(/\n{2,}/).map(function (p) {
      var t = esc(p)
        .replace(/`([^`]+)`/g, '<span class="code">$1</span>')
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer nofollow">$1</a>');
      return '<p>' + t.replace(/\n/g, '<br>') + '</p>';
    }).join('');
  }
  /** 聊天用行内格式：不分段，换行直接 <br> */
  function formatInline(text) {
    return esc(text)
      .replace(/`([^`]+)`/g, '<span class="code">$1</span>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer nofollow">$1</a>')
      .replace(/\n/g, '<br>');
  }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function clockOf(ts) {
    var d = new Date(ts);
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }
  /** 聊天分隔条上的时间：今天只给时分，昨天加「昨天」，更早给日期 */
  function chatStamp(ts) {
    var d = new Date(ts);
    var today = new Date();
    var yest = new Date(today.getTime() - 86400000);
    if (d.toDateString() === today.toDateString()) return clockOf(ts);
    if (d.toDateString() === yest.toDateString()) return '昨天 ' + clockOf(ts);
    return (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 日 ' + clockOf(ts);
  }
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  /* ---------- 图标 ---------- */
  var ICON = {
    fish: function () {
      return '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M20.8 12c-2.6-3.3-6-5-9.2-5-3.9 0-6.8 2.4-8.1 5 1.3 2.6 4.2 5 8.1 5 3.2 0 6.6-1.7 9.2-5z"/><path d="M3.5 12L1.2 8.9v6.2z"/><circle cx="8.4" cy="10.9" r="1" fill="#fff"/></svg>';
    },
    food: function () {
      return '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<path d="M3.8 12.6h16.4a8.2 8.2 0 0 1-16.4 0z" fill="currentColor" fill-opacity=".14"/>' +
        '<circle cx="9" cy="8.7" r="1.15" fill="currentColor" stroke="none"/>' +
        '<circle cx="13.6" cy="6.6" r="1.15" fill="currentColor" stroke="none"/>' +
        '<circle cx="17.2" cy="8.4" r="1.05" fill="currentColor" stroke="none"/>' +
        '</svg>';
    },
    basket: function (on) {
      return '<svg viewBox="0 0 24 24" width="14" height="14" fill="' + (on ? 'currentColor' : 'none') + '" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" aria-hidden="true"><path d="M3.6 9h16.8l-1.7 9.3a2 2 0 0 1-2 1.7H7.3a2 2 0 0 1-2-1.7z"/><path d="M8.6 9L10.2 4.6M15.4 9L13.8 4.6" stroke-linecap="round"/></svg>';
    },
    bubble: function () {
      return '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round" aria-hidden="true"><path d="M20.5 11.6a7.7 7.7 0 0 1-8.3 7.6 8.9 8.9 0 0 1-3.3-.7L4 20.3l1.7-4.1a7.7 7.7 0 0 1-1.2-4.6 7.7 7.7 0 0 1 7.7-7.6h.5a7.7 7.7 0 0 1 7.8 7.6z"/></svg>';
    },
    reply: function () {
      return '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.5 6.5L4 12l5.5 5.5"/><path d="M4 12h9.5a6 6 0 0 1 6 6v1"/></svg>';
    },
    home: function () {
      return '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M4 10.5L12 4l8 6.5V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1z"/></svg>';
    },
    users: function () {
      return '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15.6 20.2v-1.7a3.5 3.5 0 0 0-3.5-3.5H6.8a3.5 3.5 0 0 0-3.5 3.5v1.7"/><circle cx="9.4" cy="7.9" r="3.4"/><path d="M20.7 20.2v-1.7a3.5 3.5 0 0 0-2.6-3.4"/><path d="M15.7 4.6a3.4 3.4 0 0 1 0 6.6"/></svg>';
    },
    mark: function () {
      return '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M6.5 4h11a1 1 0 0 1 1 1v15l-6.5-4.2L5.5 20V5a1 1 0 0 1 1-1z"/></svg>';
    },
    user: function () {
      return '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="8.2" r="3.6"/><path d="M5.2 20.2a6.8 6.8 0 0 1 13.6 0"/></svg>';
    },
    back: function () {
      return '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>';
    },
    empty: function () {
      return '<svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M3 9.5c2-1.6 4-1.6 6 0s4 1.6 6 0 4-1.6 6 0"/><path d="M3 15c2-1.6 4-1.6 6 0s4 1.6 6 0 4-1.6 6 0"/></svg>';
    },
    whale: function (w) {
      return '<svg viewBox="0 0 120 80" width="' + w + '" height="' + Math.round(w * 0.66) + '" fill="currentColor" aria-hidden="true"><path d="M8 46c0-16 15-27 33-27 16 0 27 8 31 20l14-7v30l-14-7c-5 11-16 18-31 18C23 73 8 62 8 46z"/><path d="M46 8c0-4 3.2-7 7.2-7" stroke="currentColor" stroke-width="3.4" fill="none" stroke-linecap="round"/></svg>';
    },
    tide: function () {
      return '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">' +
        '<path d="M3 8.4c2.2-2 4.2-2 6.4 0s4.2 2 6.4 0 3-1.7 5.2 0"/>' +
        '<path d="M3 12.9c2.2-2 4.2-2 6.4 0s4.2 2 6.4 0 3-1.7 5.2 0"/>' +
        '<path d="M3 17.4c2.2-2 4.2-2 6.4 0s4.2 2 6.4 0 3-1.7 5.2 0"/>' +
        '</svg>';
    },
    send: function () {
      return '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12l16-7-7 16-2.2-6.8z"/></svg>';
    }
  };

  /* ---------- API ---------- */
  function ApiError(payload, status) {
    this.message = (payload && payload.message) || '请求失败';
    this.code = (payload && payload.code) || 'error';
    this.status = status;
  }

  function api(path, opts) {
    opts = opts || {};
    var method = opts.method || 'GET';
    var init = { method: method, credentials: 'same-origin', headers: {} };
    if (method !== 'GET') {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body || {});
    }
    return fetch(API + path, init).then(function (res) {
      return res.json().catch(function () {
        return { ok: false, error: { message: '服务器返回了看不懂的东西' } };
      }).then(function (json) {
        if (!res.ok || !json.ok) throw new ApiError(json.error, res.status);
        return json.data;
      });
    });
  }

  /* ---------- Toast ---------- */
  var toastTimer = null;
  function toast(msg, isErr) {
    var el = $('#toast');
    el.textContent = msg;
    el.className = 'toast show' + (isErr ? ' err' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.className = 'toast'; }, 2400);
  }
  function toastErr(e) {
    toast((e && e.message) || '出了点问题', true);
  }

  /* ---------- 路由 ---------- */
  function parseHash() {
    var h = (location.hash || '').replace(/^#/, '');
    if (!h || h === '/') return { view: 'home' };
    var parts = h.split('/').filter(Boolean);
    var head = parts[0];
    if (head === 'p' && parts[1]) return { view: 'post', postId: decodeURIComponent(parts[1]) };
    if (head === 'u' && parts[1]) return { view: 'user', userId: decodeURIComponent(parts[1]) };
    if (head === 't' && parts[1]) return { view: 'home', tag: decodeURIComponent(parts[1]) };
    if (head === 'basket') return { view: 'basket' };
    if (head === 'following') return { view: 'following' };
    if (head === 'chat') return { view: 'chat' };
    return { view: 'home' };
  }
  function hashFor() {
    if (S.view === 'post') return '#/p/' + encodeURIComponent(S.postId);
    if (S.view === 'user') return '#/u/' + encodeURIComponent(S.userId);
    if (S.view === 'basket') return '#/basket';
    if (S.view === 'following') return '#/following';
    if (S.view === 'chat') return '#/chat';
    if (S.tag) return '#/t/' + encodeURIComponent(S.tag);
    return '#/';
  }

  var suppressHash = false;
  function go(view, opts) {
    opts = opts || {};
    S.view = view;
    S.replying = null;
    if ('postId' in opts) { S.postId = opts.postId; S.onlyOP = false; S.expanded = {}; S.post = null; }
    if ('userId' in opts) { S.userId = opts.userId; S.user = null; }
    if ('tag' in opts) S.tag = opts.tag;
    S.page = 1;
    S.list = null;

    var h = hashFor();
    if (location.hash !== h) {
      suppressHash = true;
      location.hash = h;
    }
    load();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ---------- 加载 ---------- */
  function skeleton(n) {
    var out = '';
    for (var i = 0; i < (n || 4); i++) {
      out += '<div class="skeleton"><div class="sk-line w60"></div><div class="sk-line"></div><div class="sk-line w30"></div></div>';
    }
    return out;
  }

  function load() {
    S.loading = true;
    var main = $('#main');
    // 离开鱼汛就断开 SSE，把连接名额让出来
    if (S.view !== 'chat') chatClose();

    if (S.view === 'post') {
      if (!S.post || S.post.id !== S.postId) main.innerHTML = skeleton(3);
      return api('/posts/' + encodeURIComponent(S.postId)).then(function (d) {
        S.post = d.post;
        S.loading = false;
        renderAll();
      }).catch(function (e) {
        S.loading = false;
        main.innerHTML = emptyHTML('这层楼不在了', e.message || '可能被楼主自己拆了。');
      });
    }
    if (S.view === 'user') {
      if (!S.user) main.innerHTML = skeleton(2);
      return api('/users/' + encodeURIComponent(S.userId)).then(function (d) {
        S.user = d.user;
        S.user.isMe = d.isMe;
        S.user.following = d.following;
        S.list = d.posts;
        S.loading = false;
        renderAll();
      }).catch(function (e) {
        S.loading = false;
        main.innerHTML = emptyHTML('找不到这条鱼', e.message || '');
      });
    }
    if (S.view === 'basket' || S.view === 'following') {
      if (!S.me) { S.loading = false; renderAll(); return; }
      if (!S.list) main.innerHTML = skeleton(3);
      var path = S.view === 'basket' ? '/basket' : '/following';
      return api(path + '?page=1').then(function (d) {
        S.list = d;
        S.loading = false;
        renderAll();
      }).catch(function (e) {
        S.loading = false;
        toastErr(e);
        S.list = { items: [], total: 0, hasMore: false };
        renderAll();
      });
    }
    if (S.view === 'chat') {
      chatOpen();
      if (S.chat.loaded) {
        S.loading = false;
        renderAll();
        return Promise.resolve();
      }
      main.innerHTML = skeleton(3);
      return chatLoad();
    }
    // home
    if (!S.list) main.innerHTML = skeleton(4);
    var qs = '?sort=' + encodeURIComponent(S.sort) + '&page=1';
    if (S.tag) qs += '&tag=' + encodeURIComponent(S.tag);
    if (S.q) qs += '&q=' + encodeURIComponent(S.q);
    return api('/posts' + qs).then(function (d) {
      S.list = d;
      S.loading = false;
      renderAll();
    }).catch(function (e) {
      S.loading = false;
      toastErr(e);
      S.list = { items: [], total: 0, hasMore: false };
      renderAll();
    });
  }

  function loadMore() {
    if (!S.list || !S.list.hasMore || S.loading) return;
    S.loading = true;
    var btn = $('[data-act="load-more"]');
    if (btn) { btn.disabled = true; btn.textContent = '正在捞…'; }

    var promise;
    if (S.view === 'user') promise = api('/users/' + encodeURIComponent(S.userId) + '?page=' + (S.page + 1))
      .then(function (d) { return d.posts; });
    else if (S.view === 'basket') promise = api('/basket?page=' + (S.page + 1));
    else if (S.view === 'following') promise = api('/following?page=' + (S.page + 1));
    else {
      var qs = '?sort=' + encodeURIComponent(S.sort) + '&page=' + (S.page + 1);
      if (S.tag) qs += '&tag=' + encodeURIComponent(S.tag);
      if (S.q) qs += '&q=' + encodeURIComponent(S.q);
      promise = api('/posts' + qs);
    }

    promise.then(function (d) {
      S.page += 1;
      S.list.items = S.list.items.concat(d.items);
      S.list.hasMore = d.hasMore;
      S.loading = false;
      renderAll();
    }).catch(function (e) {
      S.loading = false;
      toastErr(e);
      renderAll();
    });
  }

  function refreshBootstrap() {
    return api('/bootstrap').then(function (d) {
      S.config = d.config;
      S.me = d.me;
      S.tags = d.tags;
      S.stats = d.stats;
      if (d.chat) {
        S.chat.online = d.chat.online || [];
        S.chatOnline = d.chat.count || 0;
      }
      applyBranding();
      renderNav();
      renderTopbar();
    });
  }

  /* ---------- 渲染：框架 ---------- */
  function applyBranding() {
    var c = S.config;
    document.title = c.name;
    $('#brandText').innerHTML = esc(c.name) + '<em>' + esc(c.tagline) + '</em>';
  }

  function renderTopbar() {
    var btn = $('#meBtn');
    if (S.me) {
      btn.innerHTML = avatarHTML(S.me, 32);
      btn.setAttribute('data-act', 'nav');
      btn.setAttribute('data-view', 'user');
      btn.title = '我的鱼档';
    } else {
      btn.innerHTML = '<span class="avatar" style="width:32px;height:32px;font-size:12px;background:#c9d6e4">?</span>';
      btn.setAttribute('data-act', 'auth-open');
      btn.removeAttribute('data-view');
      btn.title = '登录';
    }
    $('#bellBtn').hidden = !S.me;
    $('#bellDot').hidden = !(S.me && S.me.unread > 0);
  }

  function renderNav() {
    var items = [
      { view: 'home', label: '塘首页', icon: ICON.home(), cnt: null },
      { view: 'chat', label: '鱼汛', icon: ICON.tide(), cnt: S.chatOnline || null },
      { view: 'following', label: '关注的楼', icon: ICON.users(), cnt: S.me ? S.me.following : null },
      { view: 'basket', label: '我的鱼篓', icon: ICON.mark(), cnt: S.me ? S.me.bookmarks : null },
      { view: 'user', label: '我的鱼档', icon: ICON.user(), cnt: null }
    ];
    $('#navList').innerHTML = items.map(function (it) {
      var on = S.view === it.view;
      return '<button class="nav-item' + (on ? ' on' : '') + '" data-act="nav" data-view="' + it.view + '">' +
        it.icon + '<span>' + it.label + '</span>' +
        (it.cnt ? '<span class="cnt">' + it.cnt + '</span>' : '') + '</button>';
    }).join('');

    $('#tagList').innerHTML = S.tags.map(function (t) {
      return '<button class="tag-chip' + (S.tag === t.name ? ' on' : '') + '" data-act="tag" data-tag="' +
        esc(t.name) + '">' + esc(t.name) + (t.count ? ' ' + t.count : '') + '</button>';
    }).join('');
  }

  function renderRail() {
    var html = '';
    if (S.view === 'post' && S.post) {
      var p = S.post;
      var op = p.author;
      html += '<section class="card op-card">' +
        avatarHTML(op, 58) +
        '<div class="op-name">' + esc(op.fishName) + '</div>' +
        '<div class="op-sub">' + esc(op.username) + ' · ' + esc(op.fishType) + '</div>' +
        '<div class="op-bio">' + esc(op.bio || '这条鱼还没写简介。') + '</div>' +
        (S.me && S.me.id === op.id ? '' :
          '<button class="btn btn-sm' + (p.followingAuthor ? ' btn-ghost' : '') + '" data-act="follow" data-user="' +
          esc(op.id) + '">' + (p.followingAuthor ? '已关注' : '关注这条鱼') + '</button>') +
        '</section>';

      html += '<section class="card rail-card"><h4>本楼数据</h4><div class="stats-grid">' +
        '<div class="stat-cell"><b>' + (p.floors.length + 1) + '</b><span>楼层</span></div>' +
        '<div class="stat-cell"><b>' + (p.floorCount + p.replyCount) + '</b><span>回复</span></div>' +
        '<div class="stat-cell"><b>' + p.food + '</b><span>鱼粮</span></div>' +
        '<div class="stat-cell"><b style="font-size:13px;font-weight:650;padding-top:4px">' +
        timeAgo(p.createdAt) + '</b><span>开楼</span></div>' +
        '</div></section>';
    } else if (S.view === 'chat') {
      html += '<section class="card rail-card"><h4>在塘里的鱼</h4>' +
        '<div id="onlineList">' + chatOnlineListHTML() + '</div></section>';
      html += '<section class="card rail-card tip-card"><h4>鱼汛</h4><p>' +
        '这里不存档，也不产生通知。<br>想说就说，说完就走。<br><br>' +
        '聊天记录只进数据库，不进鱼篓，不上首页。</p></section>';
    } else {
      var st = S.stats || { posts: 0, floors: 0, replies: 0, members: 0, recent: 0 };
      html += '<section class="card rail-card"><h4>鱼塘水位</h4><div class="stats-grid">' +
        '<div class="stat-cell"><b>' + st.posts + '</b><span>主题楼</span></div>' +
        '<div class="stat-cell"><b>' + (st.floors + st.replies) + '</b><span>总楼层</span></div>' +
        '<div class="stat-cell"><b>' + st.recent + '</b><span>近 24 小时</span></div>' +
        '<div class="stat-cell"><b>' + st.members + '</b><span>养鱼人</span></div>' +
        '</div></section>';

      html += '<section class="card rail-card tip-card"><h4>塘规</h4><p>' +
        S.config.rules.map(esc).join('<br>') +
        '<br><br>本塘不签到、不设等级、不按顶帖排。</p></section>';

      html += '<section class="card rail-card"><h4>怎么玩</h4><p style="margin:0;font-size:12.2px;color:var(--muted);line-height:1.85">' +
        '投喂 = 点赞<br>鱼篓 = 收藏<br>追鱼 = 关注<br>冒泡 = 评论<br>撒网 = 发帖</p></section>';
    }
    html += '<p class="rail-note">Pond · 开源社区引擎</p>';
    $('#rail').innerHTML = html;
  }

  /* ---------- 渲染：列表 ---------- */
  function threadRowHTML(p) {
    var a = p.author;
    var tags = p.tags.map(function (t) { return '<i>' + esc(t) + '</i>'; }).join('');
    return '<button class="thread' + (p.pinned ? ' pinned' : '') + '" data-act="open-post" data-post="' + p.id + '">' +
      avatarHTML(a, 38) +
      '<span class="thread-main">' +
      '<span class="thread-title">' + (p.pinned ? '<span class="pin-badge">置顶</span>' : '') + esc(p.title) + '</span>' +
      (p.quote ? '<span class="thread-quote">' + esc(cut(p.quote, 60)) + '</span>' : '') +
      '<span class="thread-meta">' +
      '<span class="who">' + esc(a.fishName) + '</span>' +
      '<span class="dot">·</span><span>' + timeAgo(p.createdAt) + '</span>' +
      '<span class="dot">·</span><span class="thread-tags">' + tags + '</span>' +
      '</span></span>' +
      '<span class="thread-side">' +
      '<span class="thread-replies">' + ICON.bubble() + (p.floorCount + p.replyCount) + '</span>' +
      '<span class="thread-food">' + ICON.food() + p.food + '</span>' +
      '<span class="thread-last">最后 ' + timeAgo(p.lastReplyAt) + '</span>' +
      '</span></button>';
  }

  function emptyHTML(title, sub) {
    return '<div class="empty">' + ICON.empty() + '<h3>' + esc(title) + '</h3><p>' + esc(sub || '') + '</p></div>';
  }

  function pondHeadHTML() {
    var st = S.stats || { posts: 0, floors: 0, replies: 0, members: 0, recent: 0 };
    var c = S.config;
    return '<section class="pond-head">' +
      '<span class="pond-whale">' + ICON.whale(210) + '</span>' +
      '<div class="pond-inner">' +
      '<div class="pond-top">' +
      '<span class="pond-badge">' + ICON.whale(30) + '</span>' +
      '<div><div class="pond-title">' + esc(c.name) + '<span>' + esc(c.slug) + ' · ' + esc(c.tagline) + '</span></div>' +
      '<div class="pond-desc">' + esc(c.desc) + '</div></div>' +
      '<div class="pond-follow"><button class="btn btn-sm' + (S.me && S.me.inPond ? ' on' : '') +
      '" data-act="pond-join">' + (S.me && S.me.inPond ? '已进塘' : '进塘') + '</button></div>' +
      '</div>' +
      '<div class="pond-stats">' +
      '<div class="pond-stat"><b>' + st.recent + '</b><span>近 24 小时</span></div>' +
      '<div class="pond-stat"><b>' + st.posts + '</b><span>主题</span></div>' +
      '<div class="pond-stat"><b>' + (st.floors + st.replies) + '</b><span>楼层</span></div>' +
      '<div class="pond-stat"><b>' + st.members + '</b><span>养鱼人</span></div>' +
      '</div></div></section>';
  }

  function listBlockHTML(opts) {
    opts = opts || {};
    var list = S.list;
    if (!list) return skeleton(4);
    if (!list.items.length) return emptyHTML(opts.emptyTitle || '这里还没有楼', opts.emptySub || '换个塘口看看，或者自己开一层。');
    var html = '<div class="floor-list">' + list.items.map(threadRowHTML).join('') + '</div>';
    if (list.hasMore) {
      html += '<div class="more-wrap"><button class="btn" data-act="load-more">再捞一些（还有 ' +
        (list.total - list.items.length) + ' 层）</button></div>';
    } else if (list.items.length > 6) {
      html += '<div class="thread-end">—— 到底了 ——</div>';
    }
    return html;
  }

  /* ---------- 渲染：首页 ---------- */
  function renderHome() {
    var html = pondHeadHTML();
    html += '<button class="quick-post" data-act="new-post">' +
      '<span style="display:inline-flex">' + ICON.fish() + '</span>' +
      '<span>' + (S.me ? '说点什么，或者贴一句你鱼说过的话…' : '登录后就能发帖、投喂、收藏') + '</span>' +
      '<span class="qp-hint">Ctrl + Enter</span></button>';

    html += '<div class="feed-bar">' +
      '<button class="sort-tab' + (S.sort === 'fat' ? ' on' : '') + '" data-act="sort" data-sort="fat">最肥</button>' +
      '<button class="sort-tab' + (S.sort === 'reply' ? ' on' : '') + '" data-act="sort" data-sort="reply">最后回复</button>' +
      '<button class="sort-tab' + (S.sort === 'new' ? ' on' : '') + '" data-act="sort" data-sort="new">新开楼</button>' +
      '<span class="result-count">' +
      (S.tag ? '塘口「' + esc(S.tag) + '」· ' : '') +
      (S.q ? '搜索「' + esc(S.q) + '」· ' : '') +
      ((S.list ? S.list.total : '—') + ' 层楼') +
      '</span></div>';

    html += listBlockHTML();
    $('#main').innerHTML = html;
  }

  /* ---------- 渲染：楼层 ---------- */
  function fishSayHTML(p) {
    if (!p.quote) return '';
    return '<div class="fish-say"><span class="q-mark">「</span>' + esc(p.quote) +
      '<span class="q-mark">」</span><span class="who">—— ' + esc(p.author.fishName) + '</span></div>';
  }

  function voteBtnHTML(opts) {
    return '<button class="act' + (opts.voted ? ' on' : '') + '" data-act="feed" data-type="' + opts.type +
      '" data-id="' + opts.id + '">' + ICON.food() +
      '<span>' + (opts.count > 0 ? opts.count : (opts.type === 'reply' ? '' : '投喂')) + '</span></button>';
  }

  function subItemHTML(floor, r) {
    var a = r.author;
    return '<div class="sub-item">' +
      '<div class="sub-head">' + avatarHTML(a, 20) +
      '<span class="sub-name">' + esc(a.fishName) + '</span>' +
      (r.toUser ? '<span class="sub-to">回复 <b>' + esc(r.toUser.fishName) + '</b></span>' : '') +
      '<span class="sub-time">' + timeAgo(r.createdAt) + '</span></div>' +
      '<p class="sub-body">' + esc(r.body) + '</p>' +
      '<div class="sub-foot">' +
      voteBtnHTML({ type: 'reply', id: r.id, count: r.food, voted: r.voted }) +
      '<button class="act" data-act="reply-open" data-floor="' + floor.id + '" data-to="' + a.id +
      '" data-name="' + esc(a.fishName) + '">回复</button>' +
      '</div></div>';
  }

  function replyBoxHTML(floorId, toId, toName) {
    return '<div class="reply-box">' +
      '<textarea id="replyText" placeholder="' + (toId ? '回复 ' + esc(toName) : '说点什么…') +
      '" data-floor="' + floorId + '" data-to="' + (toId || '') + '"></textarea>' +
      '<div class="reply-box-foot">' +
      (toId ? '<span class="to-hint">正在回复 <b>' + esc(toName) + '</b></span>' : '<span class="to-hint">直接盖楼</span>') +
      '<span class="spacer"></span>' +
      '<button class="btn btn-sm btn-ghost" data-act="reply-cancel">取消</button>' +
      '<button class="btn btn-sm btn-primary" data-act="submit-reply" data-floor="' + floorId +
      '" data-to="' + (toId || '') + '">发出去</button>' +
      '</div></div>';
  }

  function floorHTML(floor) {
    var a = floor.author;
    var expanded = !!S.expanded[floor.id];
    var shown = expanded ? floor.replies : floor.replies.slice(0, 2);
    var rest = floor.replies.length - shown.length;
    var replying = S.replying && S.replying.floorId === floor.id;

    var html = '<article class="floor" id="floor-' + floor.id + '">' +
      avatarHTML(a, 42) +
      '<div>' +
      '<div class="floor-head">' +
      '<span class="floor-name">' + esc(a.fishName) +
      (floor.isOP ? '<span class="badge-op badge-lz">楼主</span>' : '') +
      '<span class="fn-sub">' + esc(a.fishType) + '</span></span>' +
      '<span class="floor-num">' + floor.num + ' 楼</span>' +
      '<span class="floor-time">' + timeAgo(floor.createdAt) + '</span>' +
      '</div>' +
      '<div class="floor-body">' + formatBody(floor.body) + '</div>' +
      '<div class="floor-acts">' +
      voteBtnHTML({ type: 'floor', id: floor.id, count: floor.food, voted: floor.voted }) +
      '<button class="act" data-act="reply-open" data-floor="' + floor.id + '" data-to="' + a.id +
      '" data-name="' + esc(a.fishName) + '">' + ICON.reply() + '回复</button>' +
      (isMod() ? '<button class="act danger" data-act="mod-floor" data-floor="' + floor.id + '">删除</button>' : '') +
      '</div>';

    if (floor.replies.length) {
      html += '<div class="sub-list">' +
        shown.map(function (r) { return subItemHTML(floor, r); }).join('') +
        (rest > 0 ? '<button class="more-sub" data-act="more-sub" data-floor="' + floor.id +
          '">查看其余 ' + rest + ' 条回复</button>' : '') +
        '</div>';
    }
    if (replying) html += replyBoxHTML(floor.id, S.replying.toId, S.replying.toName);

    return html + '</div></article>';
  }

  function isMod() {
    return !!(S.me && (S.me.role === 'mod' || S.me.role === 'admin'));
  }

  function renderPost() {
    var p = S.post;
    if (!p) return;
    var op = p.author;
    var html = '<button class="back-link" data-act="back">' + ICON.back() + '回塘首页</button>';
    html += '<div class="thread-view">';

    html += '<div class="post-shell">' +
      '<div class="post-shell-head">' +
      '<div class="post-tagrow">' +
      (p.pinned ? '<i style="background:#fff4dc;color:#b97b10">置顶</i>' : '') +
      p.tags.map(function (t) { return '<i>' + esc(t) + '</i>'; }).join('') +
      '<button class="onlyop' + (S.onlyOP ? ' on' : '') + '" data-act="toggle-op" style="margin-left:auto">只看楼主</button>' +
      (isMod() ? '<button class="onlyop" data-act="mod" data-post="' + p.id + '">版务</button>' : '') +
      '</div>' +
      '<h1 class="post-h1">' + esc(p.title) + '</h1>' +
      (p.locked ? '<div class="locked-banner">这层楼已经锁了，只能看，不能回。</div>' : '') +
      '</div>' +
      '<div class="floors">' +
      '<article class="floor" id="floor-op">' +
      avatarHTML(op, 42) +
      '<div>' +
      '<div class="floor-head">' +
      '<span class="floor-name">' + esc(op.fishName) + '<span class="badge-op">楼主</span>' +
      '<span class="fn-sub">' + esc(op.fishType) + '</span></span>' +
      '<span class="floor-num">1 楼</span>' +
      '<span class="floor-time">' + timeAgo(p.createdAt) + '</span>' +
      '</div>' +
      '<div class="floor-body">' + formatBody(p.body) + '</div>' +
      fishSayHTML(p) +
      '<div class="floor-acts">' +
      voteBtnHTML({ type: 'post', id: p.id, count: p.food, voted: p.voted }) +
      '<button class="act' + (p.bookmarked ? ' basket-on' : '') + '" data-act="bookmark" data-post="' + p.id + '">' +
      ICON.basket(p.bookmarked) + '<span>' + (p.bookmarked ? '已收进鱼篓' : '收进鱼篓') + '</span></button>' +
      (S.me && S.me.id === op.id ? '' :
        '<button class="act follow-act' + (p.followingAuthor ? ' on' : '') + '" data-act="follow" data-user="' +
        esc(op.id) + '">' + (p.followingAuthor ? '已关注楼主' : '关注楼主') + '</button>') +
      '<button class="act" data-act="report" data-type="post" data-id="' + p.id + '">举报</button>' +
      '</div>' +
      '</div></article>';

    p.floors.forEach(function (f) {
      if (S.onlyOP && !f.isOP) return;
      html += floorHTML(f);
    });

    html += '</div></div>';

    if (!p.locked) {
      html += '<div class="card" style="padding:14px 16px"><div class="reply-box">' +
        '<textarea id="replyTextMain" placeholder="' + (S.me ? '占一层楼，说点什么…' : '登录后就能盖楼') +
        '" data-floor="" data-to=""></textarea>' +
        '<div class="reply-box-foot"><span class="to-hint">Ctrl + Enter 直接发</span><span class="spacer"></span>' +
        '<button class="btn btn-sm btn-primary" data-act="submit-reply" data-floor="" data-to="">占楼</button>' +
        '</div></div></div>';
    }

    html += '<div class="thread-end">—— 到底了，共 ' + (p.floors.length + 1) + ' 层 ——</div></div>';
    $('#main').innerHTML = html;
  }

  /* ---------- 渲染：用户 / 鱼篓 / 关注 ---------- */
  function renderUser() {
    var u = S.user;
    if (!u) return;
    var html = '<button class="back-link" data-act="back">' + ICON.back() + '回塘首页</button>';
    html += '<div class="profile-head">' + avatarHTML(u, 62) +
      '<div class="profile-main">' +
      '<div class="profile-name">' + esc(u.fishName) + (u.isMe ? '<span class="badge-op" style="margin-left:7px">你</span>' : '') + '</div>' +
      '<div class="profile-fish">' + esc(u.username) + ' · ' + esc(u.fishType) +
      (u.role !== 'member' ? ' · ' + (u.role === 'admin' ? '管理员' : '版主') : '') + '</div>' +
      '<div class="profile-bio">' + esc(u.bio || '这条鱼还没写简介。') + '</div>' +
      '<div class="profile-stats">' +
      '<div><b>' + u.posts + '</b>开的楼</div>' +
      '<div><b>' + u.floors + '</b>盖的层</div>' +
      '<div><b>' + u.food + '</b>收到鱼粮</div>' +
      '<div><b>' + u.followers + '</b>被追</div>' +
      '</div></div>' +
      (u.isMe ? '<button class="btn btn-sm btn-ghost" data-act="logout">退出登录</button>' :
        '<button class="btn btn-sm' + (u.following ? ' btn-ghost' : '') + '" data-act="follow" data-user="' +
        esc(u.id) + '">' + (u.following ? '已关注' : '关注这条鱼') + '</button>') +
      '</div>';
    html += listBlockHTML({ emptyTitle: '还没开过楼', emptySub: '这条鱼只在别人的楼里冒泡。' });
    $('#main').innerHTML = html;
  }

  function renderBasket() {
    var html = '<div class="page-head"><h1>我的鱼篓</h1><p>收进来的楼' +
      (S.list ? '，共 ' + S.list.total + ' 层' : '') + '</p></div>';
    if (!S.me) {
      html += emptyHTML('还没登录', '登录之后，看到的楼才能收进鱼篓。');
    } else {
      html += listBlockHTML({ emptyTitle: '鱼篓是空的', emptySub: '看到有意思的楼，点一下「收进鱼篓」。' });
    }
    $('#main').innerHTML = html;
  }

  function renderFollowing() {
    var html = '<div class="page-head"><h1>关注的楼</h1><p>' +
      (S.me ? '你关注的 ' + S.me.following + ' 条鱼开的楼' : '登录后可以关注其他鱼') + '</p></div>';
    if (!S.me) html += emptyHTML('还没登录', '登录后才能关注别的鱼。');
    else html += listBlockHTML({ emptyTitle: '还没有关注任何鱼', emptySub: '在楼里点「关注楼主」，这里就会长出内容。' });
    $('#main').innerHTML = html;
  }

  /* ---------- 鱼汛（实时聊天） ---------- */
  // 同一个人的连续发言，5 分钟内不再重复头像和名字
  var CHAT_GROUP_MS = 5 * 60 * 1000;
  // 两条消息间隔超过 20 分钟，就插一条时间分隔
  var CHAT_GAP_MS = 20 * 60 * 1000;

  function chatSubText() {
    if (!S.chat.live) return S.chat.es ? '正在连上鱼汛…' : '鱼汛没连上';
    var n = S.chat.online.length;
    return n ? '现在有 ' + n + ' 条鱼在塘里' : '塘里暂时只有你';
  }

  function chatWhoHTML() {
    var list = S.chat.online;
    if (!list.length) return '<span class="chat-who-empty">塘里暂时只有你</span>';
    var shown = list.slice(0, 6);
    var more = list.length - shown.length;
    return '<div class="chat-who">' +
      shown.map(function (u) { return avatarHTML(u, 24); }).join('') +
      (more > 0 ? '<span class="chat-who-more">+' + more + '</span>' : '') +
      '</div>';
  }

  function chatOnlineListHTML() {
    var list = S.chat.online;
    if (!list.length) return '<p class="rail-empty">塘里暂时只有你。</p>';
    return '<div class="online-list">' + list.map(function (u) {
      return '<button class="online-item" data-act="open-user" data-user="' + esc(u.id) + '">' +
        avatarHTML(u, 26) + '<span class="online-name">' + esc(u.fishName) + '</span>' +
        '<i class="online-dot"></i></button>';
    }).join('') + '</div>';
  }

  function chatMsgHTML(m, prev) {
    var gap = prev ? m.createdAt - prev.createdAt : Infinity;
    var out = '';
    if (!prev || gap > CHAT_GAP_MS) {
      out += '<div class="chat-time">' + esc(chatStamp(m.createdAt)) + '</div>';
    }
    var same = !!prev && prev.author.id === m.author.id && gap <= CHAT_GROUP_MS;
    var mine = !!(S.me && m.author.id === S.me.id);

    out += '<div class="chat-msg' + (same ? ' tight' : '') + (mine ? ' mine' : '') + '" id="cm-' + esc(m.id) + '">' +
      (same ? '<span class="chat-ava-gap"></span>' : avatarHTML(m.author, 30)) +
      '<div class="chat-main">' +
      (same ? '' : '<div class="chat-meta"><b>' + esc(m.author.fishName) + '</b>' +
        '<span>' + clockOf(m.createdAt) + '</span></div>') +
      '<div class="chat-text">' + formatInline(m.body) + '</div>' +
      '</div>' +
      (isMod() ? '<button class="chat-del" data-act="chat-del" data-id="' + esc(m.id) +
        '" title="删除这条消息" aria-label="删除">×</button>' : '') +
      '</div>';
    return out;
  }

  function chatBodyHTML() {
    var msgs = S.chat.msgs;
    if (!msgs.length) {
      return '<div class="chat-empty">' + ICON.tide() +
        '<p>鱼汛还是安静的。<br>说第一句话的人，通常会被记住。</p></div>';
    }
    var out = '';
    var prev = null;
    for (var i = 0; i < msgs.length; i++) {
      out += chatMsgHTML(msgs[i], prev);
      prev = msgs[i];
    }
    return out;
  }

  function chatFootHTML() {
    if (!S.me) {
      return '<div class="chat-foot chat-foot-locked">' +
        '<span>进塘之后才能说话</span>' +
        '<button class="btn btn-sm btn-primary" data-act="auth-open">登录 / 注册</button></div>';
    }
    return '<div class="chat-foot">' +
      '<textarea id="chatInput" rows="1" maxlength="500" placeholder="说点什么，塘里都听得见…"></textarea>' +
      '<button class="btn btn-primary btn-sm" id="chatSend" data-act="chat-send">' + ICON.send() + '<span>发出去</span></button>' +
      '</div>';
  }

  function renderChat() {
    // 重渲染时把没发出去的草稿留住
    var oldInput = document.getElementById('chatInput');
    var draft = oldInput ? oldInput.value : '';

    var html = '<div class="page-head chat-page-head"><h1>鱼汛' +
      '<i class="chat-live' + (S.chat.live && S.chat.online.length ? ' on' : '') + '" id="chatLive"></i></h1>' +
      '<p id="chatSub">' + esc(chatSubText()) + '</p></div>';

    html += '<div class="chat-shell">' +
      '<div class="chat-bar"><div class="chat-bar-who" id="chatWho">' + chatWhoHTML() + '</div>' +
      '<span class="spacer"></span><span class="chat-bar-hint">Enter 发送 · Shift + Enter 换行</span></div>' +
      '<div class="chat-body" id="chatBody">' + chatBodyHTML() + '</div>' +
      '<button class="chat-jump" id="chatJump" hidden data-act="chat-jump"></button>' +
      chatFootHTML() +
      '</div>';

    $('#main').innerHTML = html;

    var body = document.getElementById('chatBody');
    if (body) body.scrollTop = body.scrollHeight;
    var inp = document.getElementById('chatInput');
    if (inp) {
      if (draft) { inp.value = draft; chatAutoGrow(inp); }
      if (window.innerWidth > 860) inp.focus();
    }
    paintChatJump();
  }

  function chatAutoGrow(el) {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight || 38, 120) + 'px';
  }

  function paintChatJump() {
    var el = document.getElementById('chatJump');
    if (!el) return;
    if (S.chat.pending > 0) {
      el.hidden = false;
      el.textContent = '有 ' + S.chat.pending + ' 条新消息 ↓';
    } else {
      el.hidden = true;
    }
  }

  function paintChatLive() {
    var dot = document.getElementById('chatLive');
    if (dot) dot.classList.toggle('on', !!(S.chat.live && S.chat.online.length));
    var sub = document.getElementById('chatSub');
    if (sub) sub.textContent = chatSubText();
  }

  function chatPresence(d) {
    S.chat.online = (d && d.online) || [];
    S.chatOnline = (d && d.count) || 0;
    renderNav();
    paintChatLive();
    var who = document.getElementById('chatWho');
    if (who) who.innerHTML = chatWhoHTML();
    var railList = document.getElementById('onlineList');
    if (railList) railList.innerHTML = chatOnlineListHTML();
  }

  function chatLoad() {
    return api('/chat/messages?limit=60').then(function (d) {
      S.chat.msgs = d.items || [];
      S.chat.loaded = true;
      S.chat.pending = 0;
      S.loading = false;
      renderAll();
      var body = document.getElementById('chatBody');
      if (body) body.scrollTop = body.scrollHeight;
    }).catch(function (e) {
      S.loading = false;
      S.chat.loaded = true;
      toastErr(e);
      renderAll();
    });
  }

  function chatOpen() {
    if (S.chat.es || typeof EventSource === 'undefined') return;
    var es;
    try {
      es = new EventSource(API + '/chat/stream');
    } catch (e) {
      return;
    }
    S.chat.es = es;

    es.addEventListener('hello', function (e) { chatPresence(JSON.parse(e.data)); });
    es.addEventListener('presence', function (e) { chatPresence(JSON.parse(e.data)); });
    es.addEventListener('msg', function (e) { chatAppend(JSON.parse(e.data)); });
    es.addEventListener('del', function (e) { chatRemove(JSON.parse(e.data).id); });

    es.addEventListener('open', function () {
      S.chat.live = true;
      paintChatLive();
      // 重连之后把断线期间漏掉的补回来
      if (S.chat.loaded) chatCatchUp();
    });
    es.addEventListener('error', function () {
      // EventSource 自己会重连，这里只改状态灯
      S.chat.live = false;
      paintChatLive();
    });
  }

  function chatClose() {
    if (S.chat.es) {
      S.chat.es.close();
      S.chat.es = null;
    }
    S.chat.live = false;
  }

  function chatCatchUp() {
    var last = S.chat.msgs.length ? S.chat.msgs[S.chat.msgs.length - 1].createdAt : 0;
    api('/chat/messages?after=' + last + '&limit=100').then(function (d) {
      (d.items || []).forEach(chatAppend);
    }).catch(function () { /* 下次重连再说 */ });
  }

  function chatAppend(m) {
    if (!m || !m.id) return;
    var c = S.chat;
    for (var i = c.msgs.length - 1; i >= 0; i--) {
      if (c.msgs[i].id === m.id) return;
    }
    var prev = c.msgs.length ? c.msgs[c.msgs.length - 1] : null;
    c.msgs.push(m);

    var body = document.getElementById('chatBody');
    if (!body) return;

    // 第一条消息到达时，把「鱼汛还是安静的」那句占位换掉
    if (body.querySelector('.chat-empty')) body.innerHTML = '';

    var nearBottom = body.scrollHeight - body.scrollTop - body.clientHeight < 90;
    body.insertAdjacentHTML('beforeend', chatMsgHTML(m, prev));

    if (nearBottom || (S.me && m.author.id === S.me.id)) {
      body.scrollTop = body.scrollHeight;
      c.pending = 0;
    } else {
      c.pending += 1;
    }
    paintChatJump();

    // DOM 不能无限长，超了就砍掉最早的再重画
    if (c.msgs.length > 240) {
      c.msgs = c.msgs.slice(-200);
      body.innerHTML = chatBodyHTML();
      body.scrollTop = body.scrollHeight;
    }
  }

  function chatRemove(id) {
    S.chat.msgs = S.chat.msgs.filter(function (m) { return m.id !== id; });
    var el = document.getElementById('cm-' + id);
    if (el) el.remove();
  }

  function chatSend() {
    if (!S.me) return openAuth('login');
    var inp = document.getElementById('chatInput');
    if (!inp) return;
    var text = inp.value.trim();
    if (!text) { inp.focus(); return; }
    if (S.chat.sending) return;

    S.chat.sending = true;
    var btn = document.getElementById('chatSend');
    if (btn) btn.disabled = true;

    api('/chat/messages', { method: 'POST', body: { body: text } }).then(function (d) {
      inp.value = '';
      chatAutoGrow(inp);
      // 正常情况下这条会从 SSE 回来；万一流断了，这里补上
      if (!S.chat.es || S.chat.es.readyState !== 1) chatAppend(d.message);
      var body = document.getElementById('chatBody');
      if (body) body.scrollTop = body.scrollHeight;
      S.chat.pending = 0;
      paintChatJump();
    }).catch(function (e) {
      toastErr(e);
      if (e.status === 401) openAuth('login');
    }).then(function () {
      S.chat.sending = false;
      if (btn) btn.disabled = false;
      inp.focus();
    });
  }

  function renderAll() {
    renderTopbar();
    renderNav();
    renderRail();
    if (S.view === 'post') renderPost();
    else if (S.view === 'user') renderUser();
    else if (S.view === 'basket') renderBasket();
    else if (S.view === 'following') renderFollowing();
    else if (S.view === 'chat') renderChat();
    else renderHome();
  }

  /* ---------- 登录 ---------- */
  var authMode = 'login';

  function openAuth(mode) {
    authMode = mode || 'login';
    $('#authModal').hidden = false;
    $('#authErr').hidden = true;
    syncAuthMode();
    setTimeout(function () { $('#authUser').focus(); }, 60);
  }
  function syncAuthMode() {
    var isReg = authMode === 'register';
    $('#authTitle').textContent = isReg ? '注册一条新鱼' : '登录鱼塘';
    $('#registerOnly').hidden = !isReg;
    $('#authSubmit').textContent = isReg ? '注册并进塘' : '登录';
    $('#authHint').textContent = isReg ? '新鱼第一天只能回复，不能开楼' : '没有账号？点上面的「注册」';
    $('#authPass').setAttribute('autocomplete', isReg ? 'new-password' : 'current-password');
    $$('#authSeg .seg-item').forEach(function (b) {
      b.classList.toggle('on', b.getAttribute('data-auth') === authMode);
    });
  }

  function submitAuth(e) {
    e.preventDefault();
    var username = $('#authUser').value.trim().toLowerCase();
    var password = $('#authPass').value;
    var errEl = $('#authErr');
    errEl.hidden = true;

    if (!username || !password) {
      errEl.textContent = '账号和密码都要填';
      errEl.hidden = false;
      return;
    }

    var btn = $('#authSubmit');
    btn.disabled = true;
    var payload = authMode === 'register'
      ? { username: username, password: password, fishName: $('#authFish').value.trim() || username, fishType: $('#authType').value }
      : { username: username, password: password };

    api('/auth/' + authMode, { method: 'POST', body: payload })
      .then(function (d) {
        S.me = d.me;
        $('#authModal').hidden = true;
        $('#authPass').value = '';
        return refreshBootstrap().then(function () {
          toast(authMode === 'register' ? '进塘了，先去盖两层楼' : '欢迎回来');
          return load();
        });
      })
      .catch(function (err) {
        errEl.textContent = err.message;
        errEl.hidden = false;
      })
      .then(function () { btn.disabled = false; });
  }

  function logout() {
    api('/auth/logout', { method: 'POST' }).then(function () {
      S.me = null;
      S.user = null;
      $('#notifPanel').hidden = true;
      toast('已经退出');
      return refreshBootstrap().then(function () { go('home', { tag: null }); });
    }).catch(toastErr);
  }

  /* ---------- 发帖 ---------- */
  function openComposer() {
    if (!S.me) return openAuth('login');
    var locked = S.me.trust < 1;
    $('#composerBody').hidden = locked;
    $('#composerLocked').hidden = !locked;
    if (locked) {
      var t = S.config.trust || { postMinAgeHours: 24, postMinReplies: 3 };
      $('#lockedNote').innerHTML = '新鱼第一天只能回复，不能开楼。<br><br>' +
        '先去别人的楼里盖 ' + t.postMinReplies + ' 层，或者等注册满 ' + t.postMinAgeHours + ' 小时。' +
        '<br><br>这样做是为了让塘里少一点一次性账号。';
    } else {
      S.draftTags = [];
      $('#postTitle').value = '';
      $('#postBody').value = '';
      $('#postQuote').value = '';
      renderChips();
      setTimeout(function () { $('#postBody').focus(); }, 60);
    }
    $('#composer').hidden = false;
  }

  function renderChips() {
    $('#postTags').innerHTML = (S.config.tags || []).map(function (t) {
      return '<button class="chip' + (S.draftTags.indexOf(t) > -1 ? ' on' : '') +
        '" data-act="chip" data-tag="' + esc(t) + '">' + esc(t) + '</button>';
    }).join('');
  }

  function publish() {
    var title = $('#postTitle').value.trim();
    var body = $('#postBody').value.trim();
    var quote = $('#postQuote').value.trim();
    if (body.length < 2) { toast('正文还是空的', true); $('#postBody').focus(); return; }

    var btn = $('#publishBtn');
    btn.disabled = true;
    api('/posts', { method: 'POST', body: { title: title, body: body, quote: quote, tags: S.draftTags } })
      .then(function (d) {
        $('#composer').hidden = true;
        S.sort = 'new';
        S.tag = null;
        toast('开好楼了');
        go('post', { postId: d.post.id });
      })
      .catch(function (e) {
        toastErr(e);
        if (e.status === 401) openAuth('login');
      })
      .then(function () { btn.disabled = false; });
  }

  /* ---------- 交互：投喂 ---------- */
  function paintVote(btn, voted, count, type) {
    btn.classList.toggle('on', voted);
    var span = btn.querySelector('span');
    if (span) span.textContent = count > 0 ? count : (type === 'reply' ? '' : '投喂');
    btn.classList.add('pop');
    setTimeout(function () { btn.classList.remove('pop'); }, 360);
  }

  function vote(type, id) {
    if (!S.me) return openAuth('login');
    var btn = $('[data-act="feed"][data-type="' + type + '"][data-id="' + id + '"]');
    if (btn) btn.disabled = true;
    api('/vote', { method: 'POST', body: { targetType: type, targetId: id } })
      .then(function (d) {
        if (btn) { btn.disabled = false; paintVote(btn, d.voted, d.count, type); }
        // 同步内存里的计数，避免下一次重渲染回退
        syncVote(type, id, d.voted, d.count);
        if (d.voted) toast('投了一把鱼粮');
      })
      .catch(function (e) {
        if (btn) btn.disabled = false;
        toastErr(e);
      });
  }

  function syncVote(type, id, voted, count) {
    if (type === 'post' && S.post && S.post.id === id) {
      S.post.voted = voted; S.post.food = count;
      if (S.list) S.list.items.forEach(function (p) { if (p.id === id) { p.voted = voted; p.food = count; } });
    }
    if (S.post) {
      if (type === 'floor') {
        S.post.floors.forEach(function (f) { if (f.id === id) { f.voted = voted; f.food = count; } });
      } else if (type === 'reply') {
        S.post.floors.forEach(function (f) {
          f.replies.forEach(function (r) { if (r.id === id) { r.voted = voted; r.food = count; } });
        });
      }
    }
  }

  function bookmark(postId) {
    if (!S.me) return openAuth('login');
    api('/bookmark', { method: 'POST', body: { postId: postId } }).then(function (d) {
      if (S.post && S.post.id === postId) S.post.bookmarked = d.bookmarked;
      if (S.me) S.me.bookmarks = Math.max(0, (S.me.bookmarks || 0) + (d.bookmarked ? 1 : -1));
      toast(d.bookmarked ? '收进鱼篓了' : '从鱼篓里拿出去了');
      renderAll();
    }).catch(toastErr);
  }

  function follow(userId) {
    if (!S.me) return openAuth('login');
    api('/follow', { method: 'POST', body: { userId: userId } }).then(function (d) {
      if (S.me) S.me.following = Math.max(0, (S.me.following || 0) + (d.following ? 1 : -1));
      if (S.post && S.post.author.id === userId) S.post.followingAuthor = d.following;
      if (S.user && S.user.id === userId) {
        S.user.following = d.following;
        S.user.followers = Math.max(0, (S.user.followers || 0) + (d.following ? 1 : -1));
      }
      toast(d.following ? '开始追这条鱼' : '不追这条鱼了');
      renderAll();
    }).catch(toastErr);
  }

  function joinPond() {
    if (!S.me) return openAuth('login');
    api('/pond/join', { method: 'POST' }).then(function (d) {
      S.me.inPond = d.inPond;
      S.stats = d.stats;
      toast(d.inPond ? '进塘了，塘里多了你一条' : '退塘了');
      renderAll();
    }).catch(toastErr);
  }

  /* ---------- 交互：回复 ---------- */
  function submitReply(floorId, toId) {
    if (!S.me) return openAuth('login');
    var ta = document.getElementById(floorId ? 'replyText' : 'replyTextMain');
    if (!ta) return;
    var text = ta.value.trim();
    if (!text) { toast('空着发不出去', true); ta.focus(); return; }

    var body = { body: text };
    if (toId) body.toUserId = toId;
    var path = floorId ? '/floors/' + floorId + '/replies' : '/posts/' + S.postId + '/floors';

    api(path, { method: 'POST', body: body }).then(function (d) {
      S.post = d.post;
      S.replying = null;
      if (floorId) S.expanded[floorId] = true;
      renderAll();
      toast('发出来了');
      if (floorId) {
        var el = document.getElementById('floor-' + floorId);
        if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      } else {
        var floors = $$('.floor');
        if (floors.length) floors[floors.length - 1].scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    }).catch(toastErr);
  }

  /* ---------- 通知 ---------- */
  function toggleNotif() {
    var panel = $('#notifPanel');
    if (!panel.hidden) { panel.hidden = true; return; }
    if (!S.me) return openAuth('login');
    panel.hidden = false;
    $('#notifList').innerHTML = '<div class="notif-empty">正在看…</div>';
    api('/notifications').then(function (d) {
      S.notif = d;
      if (!d.items.length) {
        $('#notifList').innerHTML = '<div class="notif-empty">还没有通知。去盖两层楼试试。</div>';
        return;
      }
      $('#notifList').innerHTML = d.items.map(function (n) {
        return '<button class="notif-item' + (n.read ? '' : ' unread') + '" data-act="notif-open" data-post="' +
          (n.postId || '') + '">' +
          (n.actor ? avatarHTML(n.actor, 30) : '') +
          '<span class="ni-main"><span class="ni-text"><b>' + esc(n.actor ? n.actor.fishName : '鱼塘') +
          '</b> ' + esc(n.text) + '</span>' +
          '<span class="ni-time">' + timeAgo(n.createdAt) + '</span></span></button>';
      }).join('');
    }).catch(function (e) {
      $('#notifList').innerHTML = '<div class="notif-empty">' + esc(e.message) + '</div>';
    });
  }

  function markRead() {
    api('/notifications/read', { method: 'POST' }).then(function () {
      if (S.me) S.me.unread = 0;
      renderTopbar();
      $$('.notif-item').forEach(function (el) { el.classList.remove('unread'); });
      toast('都看过了');
    }).catch(toastErr);
  }

  /* ---------- 通用抽屉（版务 / 举报） ---------- */
  function openSheet(title, html) {
    $('#modModal .dialog-head h3').textContent = title;
    $('#modActions').innerHTML = html;
    $('#modModal').hidden = false;
  }

  function openMod(postId) {
    var p = S.post;
    if (!p) return;
    openSheet('版务操作',
      '<button class="btn" data-act="mod-pin" data-post="' + postId + '">' + (p.pinned ? '取消置顶' : '置顶这层楼') + '</button>' +
      '<button class="btn" data-act="mod-lock" data-post="' + postId + '">' + (p.locked ? '解除锁定' : '锁定（禁止回复）') + '</button>' +
      '<button class="btn btn-danger" data-act="mod-del-post" data-post="' + postId + '">删除这层楼</button>');
  }

  function openReport(type, id) {
    if (!S.me) return openAuth('login');
    openSheet('举报',
      '<label class="field"><span>说说为什么</span>' +
      '<textarea id="reportReason" class="field-body" style="min-height:88px" placeholder="比如：广告、人身攻击、与塘无关"></textarea></label>' +
      '<div class="dialog-foot"><span class="hint">版主会看到</span>' +
      '<button class="btn btn-primary" data-act="report-submit" data-type="' + type + '" data-id="' + id + '">提交</button></div>');
  }

  function submitReport(type, id) {
    var reason = ($('#reportReason') && $('#reportReason').value.trim()) || '';
    if (reason.length < 2) return toast('写一句理由吧', true);
    api('/report', { method: 'POST', body: { targetType: type, targetId: id, reason: reason } })
      .then(function () {
        $('#modModal').hidden = true;
        toast('收到，版主会看');
      }).catch(toastErr);
  }

  function modAction(kind, postId) {
    var p = S.post;
    if (!p) return;
    var body = { postId: postId };
    if (kind === 'pin') body.pinned = !p.pinned;
    if (kind === 'lock') body.locked = !p.locked;
    if (kind === 'del') body.deleted = true;

    api('/mod/post', { method: 'POST', body: body }).then(function () {
      $('#modModal').hidden = true;
      if (kind === 'del') { toast('删掉了'); go('home', { tag: null }); return; }
      toast(kind === 'pin' ? (body.pinned ? '置顶了' : '取消置顶') : (body.locked ? '锁了' : '解锁了'));
      return load();
    }).catch(toastErr);
  }

  /* ---------- 事件 ---------- */
  document.addEventListener('click', function (e) {
    var closeBtn = e.target.closest('[data-close]');
    if (closeBtn) {
      document.getElementById(closeBtn.getAttribute('data-close')).hidden = true;
      return;
    }
    if (e.target.id === 'authModal' || e.target.id === 'composer' || e.target.id === 'modModal') {
      e.target.hidden = true;
      return;
    }

    var seg = e.target.closest('[data-auth]');
    if (seg) { authMode = seg.getAttribute('data-auth'); syncAuthMode(); return; }

    var t = e.target.closest('[data-act]');
    if (!t) return;
    var act = t.getAttribute('data-act');

    switch (act) {
      case 'nav': {
        var v = t.getAttribute('data-view');
        if (v === 'user') {
          if (!S.me) return openAuth('login');
          return go('user', { userId: S.me.id });
        }
        if (v === 'basket' || v === 'following') {
          if (!S.me) return openAuth('login');
        }
        return go(v, { tag: null });
      }
      case 'open-post':
        return go('post', { postId: t.getAttribute('data-post') });
      case 'open-user':
        return go('user', { userId: t.getAttribute('data-user') });
      case 'back':
        return go('home', { tag: null });
      case 'tag': {
        var tg = t.getAttribute('data-tag');
        return go('home', { tag: S.tag === tg ? null : tg });
      }
      case 'sort':
        S.sort = t.getAttribute('data-sort');
        S.page = 1;
        S.list = null;
        return load();
      case 'load-more':
        return loadMore();
      case 'new-post':
        return openComposer();
      case 'chip': {
        var ctag = t.getAttribute('data-tag');
        var i = S.draftTags.indexOf(ctag);
        if (i > -1) S.draftTags.splice(i, 1);
        else {
          if (S.draftTags.length >= 2) return toast('最多选 2 个塘口', true);
          S.draftTags.push(ctag);
        }
        return renderChips();
      }
      case 'toggle-op':
        S.onlyOP = !S.onlyOP;
        return renderAll();
      case 'feed':
        return vote(t.getAttribute('data-type'), t.getAttribute('data-id'));
      case 'bookmark':
        return bookmark(t.getAttribute('data-post'));
      case 'follow':
        return follow(t.getAttribute('data-user'));
      case 'pond-join':
        return joinPond();
      case 'reply-open':
        if (!S.me) return openAuth('login');
        S.replying = {
          floorId: t.getAttribute('data-floor'),
          toId: t.getAttribute('data-to') || null,
          toName: t.getAttribute('data-name') || ''
        };
        renderAll();
        var ta = document.getElementById('replyText');
        if (ta) {
          ta.focus();
          ta.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }
        return;
      case 'reply-cancel':
        S.replying = null;
        return renderAll();
      case 'submit-reply':
        return submitReply(t.getAttribute('data-floor'), t.getAttribute('data-to'));
      case 'more-sub':
        S.expanded[t.getAttribute('data-floor')] = true;
        return renderAll();
      case 'report':
        return openReport(t.getAttribute('data-type'), t.getAttribute('data-id'));
      case 'report-submit':
        return submitReport(t.getAttribute('data-type'), t.getAttribute('data-id'));
      case 'mod':
        return openMod(t.getAttribute('data-post'));
      case 'mod-pin':
        return modAction('pin', t.getAttribute('data-post'));
      case 'mod-lock':
        return modAction('lock', t.getAttribute('data-post'));
      case 'mod-del-post':
        return modAction('del', t.getAttribute('data-post'));
      case 'mod-floor':
        api('/mod/content', { method: 'POST', body: { targetType: 'floor', targetId: t.getAttribute('data-floor') } })
          .then(function () { toast('删掉了'); return load(); }).catch(toastErr);
        return;
      case 'auth-open':
        return openAuth('login');
      case 'chat-send':
        return chatSend();
      case 'chat-jump': {
        var cb = document.getElementById('chatBody');
        if (cb) cb.scrollTop = cb.scrollHeight;
        S.chat.pending = 0;
        return paintChatJump();
      }
      case 'chat-del':
        return api('/mod/chat', { method: 'POST', body: { messageId: t.getAttribute('data-id') } })
          .then(function () { toast('删掉了'); })
          .catch(toastErr);
      case 'logout':
        return logout();
      case 'notif-open': {
        var pid = t.getAttribute('data-post');
        $('#notifPanel').hidden = true;
        if (pid) go('post', { postId: pid });
        return;
      }
      default:
        return;
    }
  });

  $('#authForm').addEventListener('submit', submitAuth);
  $('#publishBtn').addEventListener('click', publish);
  $('#bellBtn').addEventListener('click', function (e) { e.stopPropagation(); toggleNotif(); });
  $('#notifReadAll').addEventListener('click', markRead);
  $('#newPostBtn').addEventListener('click', openComposer);

  document.addEventListener('click', function (e) {
    var panel = $('#notifPanel');
    if (panel.hidden) return;
    if (e.target.closest('#notifPanel') || e.target.closest('#bellBtn')) return;
    panel.hidden = true;
  });

  /* 搜索：防抖 */
  var searchTimer = null;
  $('#searchInput').addEventListener('input', function (e) {    var v = e.target.value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(function () {
      S.q = v.trim();
      if (S.view !== 'home') {
        S.view = 'home';
        var h = hashFor();
        if (location.hash !== h) { suppressHash = true; location.hash = h; }
      }
      S.page = 1;
      S.list = null;
      load();
    }, 260);
  });

  /* 鱼汛输入框自动长高 */
  document.addEventListener('input', function (e) {
    if (e.target && e.target.id === 'chatInput') chatAutoGrow(e.target);
  });

  /* Ctrl + Enter */
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      ['authModal', 'composer', 'modModal'].forEach(function (id) {
        var el = document.getElementById(id);
        if (el && !el.hidden) el.hidden = true;
      });
      $('#notifPanel').hidden = true;
    }

    // 鱼汛：Enter 发送，Shift + Enter 换行
    // 注意输入法：中文候选词状态下按 Enter 是选词，不能当成发送
    if (e.target && e.target.id === 'chatInput') {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) {
        e.preventDefault();
        chatSend();
      }
      return;
    }

    if (!(e.ctrlKey || e.metaKey) || e.key !== 'Enter') return;
    var id = e.target.id;
    if (id === 'replyText' || id === 'replyTextMain') {
      submitReply(e.target.getAttribute('data-floor') || '', e.target.getAttribute('data-to') || '');
    } else if (id === 'postBody' || id === 'postTitle' || id === 'postQuote') {
      publish();
    }
  });

  window.addEventListener('hashchange', function () {
    if (suppressHash) { suppressHash = false; return; }
    var r = parseHash();
    S.view = r.view;
    S.postId = r.postId || null;
    S.userId = r.userId || null;
    S.tag = r.tag || null;
    S.post = null;
    S.user = null;
    S.list = null;
    S.page = 1;
    S.replying = null;
    load();
    window.scrollTo({ top: 0 });
  });

  /* ---------- 启动 ---------- */
  function boot() {
    var r = parseHash();
    S.view = r.view;
    S.postId = r.postId || null;
    S.userId = r.userId || null;
    S.tag = r.tag || null;

    $('#main').innerHTML = skeleton(4);
    refreshBootstrap().then(load).catch(function (e) {
      $('#main').innerHTML = emptyHTML('连不上服务器', e.message || '');
    });
  }

  boot();
})();
