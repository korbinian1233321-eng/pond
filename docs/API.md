# Pond · 接口文档

所有接口在 `/api/*` 下，请求与响应都是 JSON。

**响应约定**

```json
{ "ok": true, "data": { ... } }
{ "ok": false, "error": { "code": "trust_too_low", "message": "新鱼第一天只能回复…" } }
```

**鉴权**：登录成功后服务端下发 `pond_sid`（HttpOnly + SameSite=Lax）。之后同源请求自动携带。

**写操作**必须带 `Content-Type: application/json`，否则返回 `415`。

**限流**：按 IP，写 90 次/分钟、读 600 次/分钟，超出返回 `429`。

---

## 不是接口的那几条路径

前端不再是纯 hash 路由，下面这些路径由服务端直接渲染 HTML（给爬虫和首屏用），不走 JSON：

| 路径 | 内容 | 备注 |
|---|---|---|
| `/` | 首页：站点信息 + 最近 20 层楼 | 带 `WebSite` 结构化数据 |
| `/p/:id` | 楼层页：楼主正文 + 全部楼层 + 楼中楼 | 带 `DiscussionForumPosting`；不存在返回 **404** |
| `/u/:id` | 鱼档页：简介、统计、TA 开的楼 | 带 `ProfilePage` |
| `/t/:tag` | 塘口页：该标签下所有楼 | |
| `/sitemap.xml` | 全站网址 | 首页 + 塘口 + 楼层 + 鱼档，带 `lastmod` |
| `/robots.txt` | 放行正文，挡住 `/api/`、`/chat`、`/basket`、`/following` | |
| `/chat` `/basket` `/following` | 单页外壳 | 都要登录/实时连接，没有收录价值 |

页面里用到的数据仍然是上面这些接口的数据，只是换了种输出格式。想要 JSON 就去 `/api/*`。

---

## 元信息

### `GET /api/bootstrap`

前端启动时调用一次，返回站点配置、当前用户、标签计数、全站统计。

```json
{
  "config": { "name": "大肥鱼塘", "slug": "dafeiyu", "tagline": "...", "desc": "...", "rules": ["..."], "tags": ["..."], "trust": { "postMinAgeHours": 24, "postMinReplies": 3 } },
  "me": { "id": "u_x", "username": "admin", "fishName": "塘主", "role": "admin", "trust": 2, "unread": 0, "bookmarks": 0, "following": 0, "inPond": true },
  "tags": [{ "name": "鱼言鱼语", "count": 3 }],
  "stats": { "posts": 7, "floors": 20, "replies": 23, "users": 9, "members": 9, "today": 0, "recent": 2 },
  "chat": { "online": [{ "id": "u_y", "fishName": "青柠气泡", "fishType": "女仆鲸" }], "count": 1 }
}
```

`me` 在未登录时为 `null`。

---

## 鉴权

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/auth/register` | `{username, password, fishName?, fishType?}` |
| POST | `/api/auth/login` | `{username, password}` |
| POST | `/api/auth/logout` | 清除会话 |
| GET | `/api/me` | 当前用户 |
| POST | `/api/me/profile` | `{fishName?, fishType?, bio?}` 改资料 |

注册规则：账号 `^[a-z0-9_-]{3,24}$`，密码 8–128 位。重复账号返回 `409 username_taken`。

错误码：`bad_username` `weak_password` `username_taken` `bad_credentials` `unauthorized`

---

## 帖子

### `GET /api/posts`

查询参数：

| 参数 | 默认 | 说明 |
|---|---|---|
| `sort` | `fat` | `fat`（时间衰减热度）/ `reply`（最后回复）/ `new`（最新） |
| `tag` | — | 按标签过滤 |
| `q` | — | 搜索标题、正文、鱼言、作者名 |
| `page` | `1` | 页码 |
| `limit` | `20` | 每页条数，上限 50 |

返回 `{ items: [...], total, page, limit, hasMore }`。置顶帖永远排在最前。

列表项字段：`id title quote tags author pinned locked createdAt lastReplyAt floorCount replyCount food voted bookmarked`

### `GET /api/posts/:id`

返回完整帖子：在列表项基础上多 `body`、`followingAuthor`、`floors[]`。

`floors[]` 每项：`id num body author isOP createdAt food voted replies[]`

`replies[]` 每项：`id body author toUser createdAt food voted`

`num` 是楼层号，从 2 开始（1 楼是楼主正文，不占 `floors` 数组）。

### `POST /api/posts`

```json
{ "title": "标题（可空，空则截取正文首行）", "body": "正文", "quote": "鱼言（可空）", "tags": ["求助"] }
```

- 需要登录，且 `trust >= 1`，否则 `403 trust_too_low`
- 标题 ≤ 80、正文 ≤ 8000、鱼言 ≤ 140
- 标签最多 2 个，且必须在站点标签表内（不在表内的会被静默丢弃）

### `POST /api/posts/:id/floors`

盖一层新楼。`{ "body": "..." }`，≤ 4000 字。楼锁定时返回 `403 locked`。

### `POST /api/floors/:id/replies`

楼中楼。`{ "body": "...", "toUserId": "u_x"? }`，≤ 1000 字。

上面两个接口都返回更新后的完整帖子，前端直接替换即可。

---

## 互动

| 方法 | 路径 | 请求体 | 说明 |
|---|---|---|---|
| POST | `/api/vote` | `{targetType, targetId}` | 投喂。`targetType` = `post` / `floor` / `reply`。同一个目标再调一次即取消 |
| POST | `/api/bookmark` | `{postId}` | 收进/拿出鱼篓 |
| POST | `/api/follow` | `{userId}` | 追鱼/取关。不能关注自己（`400`） |
| POST | `/api/pond/join` | 无 | 进塘/退塘 |
| GET | `/api/basket` | — | 我的鱼篓（需登录） |
| GET | `/api/following` | — | 关注的楼（需登录） |

`/api/vote` 返回 `{ voted, count }`，可以直接用来更新按钮，不需要重新拉帖子。

---

## 鱼汛（实时聊天）

三个接口：读历史、发消息、订阅实时流。

### `GET /api/chat/messages`

| 参数 | 默认 | 说明 |
|---|---|---|
| `limit` | `50` | 条数，上限 100 |
| `before` | — | 取这个时间戳（毫秒）之前的消息，用于上翻历史 |
| `after` | — | 取这个时间戳之后的消息，用于断线重连补齐 |

返回 `{ items: [...], hasMore }`，`items` **永远按时间正序**（旧 → 新），前端直接 append 就行。

```json
{
  "items": [
    {
      "id": "m_x",
      "body": "这家的红烧肉不行",
      "createdAt": 1793292672442,
      "author": { "id": "u_y", "username": "ali", "fishName": "白饭仙人", "fishType": "女仆鲸", "bio": "...", "role": "member" }
    }
  ],
  "hasMore": false
}
```

已删除的消息不会出现在结果里。

### `POST /api/chat/messages`

需要登录。`{ "body": "..." }`，≤ 500 字，超出截断。

- 空消息返回 `400`
- 按**人**限流：30 秒内最多 12 条，超出 `429 rate_limited`

成功返回 `{ message: {...} }`，同时向所有在线连接广播一个 `msg` 事件。

### `GET /api/chat/stream`

SSE 长连接，`Content-Type: text/event-stream`。**不需要登录**（可以只看不说）。

服务端每 25 秒发一次 `: ping` 心跳。客户端断开时自动清理。

事件类型：

| event | data | 时机 |
|---|---|---|
| `hello` | `{ me, online, count }` | 连上时一次 |
| `presence` | `{ online, count }` | 有人进/出 |
| `msg` | 单条消息，结构同 `/api/chat/messages` 的 item | 有人发言 |
| `del` | `{ id }` | 消息被版主删除 |

```
event: msg
data: {"id":"m_x","body":"有人在吗","createdAt":1793292672442,"author":{...}}

```

连接上限：单账号 3 条、单 IP 12 条、全站 300 条。超出分别返回 `429 too_many_windows` / `429 too_many_connections` / `503 chat_full`。

在终端里看效果：

```bash
curl -N http://127.0.0.1:3000/api/chat/stream
```

### `POST /api/mod/chat`

版主删除单条消息。`{ "messageId": "m_x" }`，删除后广播 `del`。

---

## 用户

### `GET /api/users/:id`

```json
{
  "user": { "id": "u_x", "username": "admin", "fishName": "塘主", "fishType": "野生鲸", "bio": "...", "role": "admin", "trust": 2, "createdAt": 0, "posts": 3, "floors": 5, "food": 12, "followers": 2 },
  "isMe": false,
  "following": false,
  "posts": { "items": [], "total": 3, "hasMore": false }
}
```

---

## 通知

### `GET /api/notifications`

返回最近 40 条 + `unread` 计数。

```json
{ "items": [{ "id": "n_x", "type": "follow", "text": "开始追你的鱼", "postId": null, "read": false, "createdAt": 0, "actor": { "id": "u_y", "fishName": "青柠气泡" } }], "unread": 1 }
```

`type`：`vote` / `reply` / `floor` / `follow` / `pond`

### `POST /api/notifications/read`

全部标记已读。

---

## 举报与版务

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| POST | `/api/report` | 登录 | `{targetType, targetId, reason}`，reason ≥ 2 字 |
| GET | `/api/mod/reports` | 版主 | 未处理举报列表 |
| POST | `/api/mod/report/resolve` | 版主 | `{reportId}` |
| POST | `/api/mod/post` | 版主 | `{postId, pinned?, locked?, deleted?}` |
| POST | `/api/mod/content` | 版主 | `{targetType: floor\|reply, targetId}` 删除楼层或楼中楼 |

版主 = `role` 为 `mod` 或 `admin`。

---

## 错误码

| code | HTTP | 含义 |
|---|---|---|
| `bad_request` | 400 | 参数不合法 |
| `unauthorized` | 401 | 未登录 |
| `forbidden` | 403 | 权限不足 |
| `trust_too_low` | 403 | 新号还不能开楼 |
| `locked` | 403 | 楼已锁定 |
| `not_found` | 404 | 资源不存在 |
| `username_taken` | 409 | 账号重复 |
| `payload_too_large` | 413 | 请求体超过 256KB |
| `unsupported_media_type` | 415 | 不是 JSON 请求 |
| `rate_limited` | 429 | 触发限流 |
| `too_many_windows` | 429 | 同一账号开的鱼汛窗口太多 |
| `too_many_connections` | 429 | 同一 IP 连进来的鱼汛窗口太多 |
| `chat_full` | 503 | 鱼汛连接数到顶 |
| `internal` | 500 | 服务端异常 |
