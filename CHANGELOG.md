# 更新日志

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### 计划中

- 图片转码 / 缩略图
- 全文搜索（SQLite FTS5）
- 举报处理页（接口已有，前端只做了提交）
- 用户主页可编辑（接口已有，前端没入口）

---

## [0.6.0] - 2026-10-30

### 变更

- **图片默认关闭。** `pond.config.js` 里 `images: false`，也可以用 `POND_IMAGES=1` / `0` 覆盖，不用改文件
  - 关着时：`POST /api/upload` 返回 `403 images_disabled`，「图片」按钮不显示，粘贴和拖拽图片不响应
  - 已经传上去的旧图仍然能显示——关的是「发新的」，不是「抹掉旧的」
  - 代码没删，开关打开就全回来了

### 为什么

图片是社区运营成本的分水岭：磁盘、审核、外链失效、有人传不合适的东西。这些会在你还只有十个用户的时候找上门。文字社区先跑起来，等人真的来了再开。

### 新增

- 测试 41 → 44，新增 `test/images-off.test.js`（关着的时候上传被拒、配置如实下发给前端）

---

## [0.5.0] - 2026-10-30

「能贴图」版本。之前是纯文本社区，贴截图只能外链，而图床链接半年后会死。

### 新增

- **图片上传**：截图后 `Ctrl+V` 直接粘贴、拖进输入框、或点「图片」按钮选文件
  - `POST /api/upload` 收原始字节（不是 multipart——内置模块没有解析器，手写一个比 `fetch(file)` 更容易出错）
  - `GET /uploads/:file` 对外提供，`Cache-Control: immutable`（文件名带随机 id，内容永不改变）
  - `DELETE /api/uploads/:id`，本人和版主可用
- **`lib/upload.js`**：按魔数认 PNG / JPG / GIF / WebP，从文件头读宽高
- 正文里的 `![](/uploads/xxx.png)` 渲染成 `<img>`，带 `width` / `height`，图加载完页面不会往下跳
- 测试 29 → 41，新增 `test/upload.test.js`

### 安全

- **只信文件头**，不信 `Content-Type` 也不信扩展名。把 `.php` 改名成 `.png` 传上来会被 415 挡掉
- **不收 SVG**：SVG 是 XML，能带 `<script>`，同源托管等于给自己开一个 XSS 后门
- **只显示站内图**：外链 `![]()` 一律当普通文字，否则别人贴个第三方 URL 就能拿到每个读者的 IP
- 文件名由服务端生成，`/uploads/` 只接受 `f_[a-z0-9]+.(png|jpg|gif|webp)` 这个形状，路径穿越直接 404
- 上传超限时先回 413 再关连接。直接 `destroy()` 的话客户端只看到「网络错误」，用户永远不知道是自己那张图太大

---

## [0.4.0] - 2026-10-30

「能上线」版本。补的是从「本机能跑」到「公网上不出事」之间缺的那几块。

### 安全

- **`X-Forwarded-For` 不再无条件采信**：以前任何客户端只要自己填这个头，就能每次换一个假 IP，把所有按 IP 的限流（含登录爆破防护）全部绕过。现在默认只认 socket 地址，确实挂在反代后面才设 `POND_TRUST_PROXY=1`
- 启动时自检部署配置：对外监听但缺 `POND_TRUST_PROXY` / `POND_SECURE_COOKIE` / `POND_BASE_URL`，或示例账号的公开口令还在，都会打出 `⚠`

### 新增

- **`scripts/set-password.js`**：改口令 / 提管理员 / 列账号。没给口令就随机生成，改完踢掉该账号所有会话。给「没有邮箱、忘了就没了」兜底
- **`deploy/pond.service`**：systemd unit，`ProtectSystem=strict` + 只放开 `data/` 可写
- **`deploy/Caddyfile`**：反代 + 自动 HTTPS，`flush_interval -1` 保证 SSE 不缓冲
- **`docs/DEPLOY.md`**：机器放哪（为什么不能放大陆）、域名实名、防火墙、备份、微信拦截的现实
- 测试 26 → 29，新增 `test/proxy.test.js` / `test/proxy-trust.test.js`

### 变更

- README 部署章节重写，指向 `docs/DEPLOY.md` 和 `deploy/` 里的现成配置
- `.env.example` 补 `POND_TRUST_PROXY`

---

## [0.3.0] - 2026-10-30

「让爬虫看得见」版本。之前整个站是一个空壳 HTML，爬虫抓到的内容为零，每一层楼都搜不到。

### 新增

- **真路径路由**：`#/p/:id` → `/p/:id`，另有 `/u/:id`、`/t/:tag`、`/chat`、`/basket`、`/following`
  - 走 `history.pushState` / `popstate`，不整页刷新，浏览器前进后退正常
  - 老 hash 链接进来会 `replaceState` 成真路径，不会 404
- **服务端渲染**（`lib/render.js`）：`/`、`/p/:id`、`/u/:id`、`/t/:tag` 先把正文拼进 HTML
  - 每页注入 `title`、`description`、`canonical`、OG、`twitter:card`
  - 楼层页带 `DiscussionForumPosting` 结构化数据，鱼档页带 `ProfilePage`
  - 浏览器加载完 `app.js` 后整个替换成可交互版本；首屏不再闪骨架屏
- **`/sitemap.xml`**：首页 + 全部塘口 + 全部楼层 + 全部鱼档，带 `lastmod`，同 URL 自动去重
- **`/robots.txt`**：放行正文页，挡住 `/api/`、`/chat`、`/basket`、`/following`
- **`POND_BASE_URL`**：指定对外绝对地址，`canonical` / sitemap 用它拼网址；不设则从 `X-Forwarded-Proto` / `Host` 推断
- 不存在的楼返回 **404**（带 `X-Robots-Tag: noindex`），不再返回 200 的空壳
- 测试 18 → 26，新增 `test/seo.test.js`

### 变更

- 楼列表、侧栏塘口、返回链接从 `<button>` 改成 `<a href>`：能被爬虫跟随、能中键新标签页打开、能复制链接
- 页面标题跟着视图走（`楼层标题 · 站点名`），不再是全站一个标题
- 摘要里的 `**加粗**`、`` `代码` `` 标记会先剥掉再进 `meta description`

### 修复

- `applyBranding()` 每次刷新都会把 `document.title` 改回站点名，覆盖掉当前页标题

---

## [0.2.0] - 2026-10-30

### 新增

- **鱼汛（实时聊天）**：塘边的公共聊天室，SSE 推送，带在线鱼群列表
  - `GET /api/chat/stream` 长连接，事件 `hello` / `presence` / `msg` / `del`
  - `GET /api/chat/messages` 支持 `before` 上翻、`after` 增量补漏
  - 连续发言合并头像，超过 20 分钟插时间分隔
  - 滚上去看历史时显示「N 条新消息」，不强制拽回底部
  - 版主可删单条消息（`POST /api/mod/chat`）
  - 连接上限：单账号 3、单 IP 12、全站 300
- **`pond.config.js`**：站点名、副标题、简介、塘规、塘口、信任规则集中到一个文件，fork 之后不用改 `lib/` 里的代码
- **`POND_ADMIN`**：声明哪个账号是管理员，注册即生效。解决自托管社区「第一个用户怎么变成管理员」的问题
- 配置自检：启动时检查 `pond.config.js`，塘口为空或过多会给出警告

### 变更

- 塘口（标签）不再写死在 `lib/api.js` 的 `ALL_TAGS`，改为读 `pond.config.js`；不在配置里的标签在发帖时被丢弃
- 信任规则（`lib/auth.js` 的 `TRUST_RULES`）现在真的由 `pond.config.js` 的 `trust` 段驱动——之前这个配置只是发给前端显示，并不影响实际判定
- 自定义塘口时跳过示例数据，避免出现「帖子挂着不存在的塘口」
- 测试数量 12 → 18

### 修复

- `.online-item span` 选择器误伤头像，导致在线列表里的头像被拉成椭圆
- 鱼汛顶栏的在线头像与文字上下堆叠，把聊天栏撑到 68px

### 工程

- 加 GitHub Actions（Node 22 / 24 双版本 + 启动冒烟）
- 加 issue / PR 模板、`SECURITY.md`、`.editorconfig`、`.dockerignore`

---

## [0.1.0] - 2026-10-30

首个可运行版本。

### 新增

- 塘 + 楼层结构：1 楼楼主正文，2 楼起为回复，楼中楼一层嵌套
- 投喂（点赞）、鱼篓（收藏）、追鱼（关注）、冒泡（评论）
- 信任等级：新号 24 小时内只能回复，回复满 3 层或注册满 24 小时解锁
- 版主：置顶、锁定、删除；举报入口
- 时间衰减排序 `food / (hours + 2) ^ 0.8`
- scrypt 口令 + 数据库会话 + HttpOnly Cookie
- 全站 CSP、安全响应头、按 IP 限流
- 12 个接口测试
- Docker / docker-compose 部署

[Unreleased]: https://github.com/korbinian1233321-eng/pond/compare/v0.6.0...HEAD
[0.6.0]: https://github.com/korbinian1233321-eng/pond/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/korbinian1233321-eng/pond/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/korbinian1233321-eng/pond/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/korbinian1233321-eng/pond/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/korbinian1233321-eng/pond/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/korbinian1233321-eng/pond/releases/tag/v0.1.0
