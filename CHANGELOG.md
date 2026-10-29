# 更新日志

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### 计划中

- 图片 / 附件（对象存储）
- 全文搜索（SQLite FTS5）
- 举报处理页（接口已有，前端只做了提交）
- 用户主页可编辑（接口已有，前端没入口）

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

[Unreleased]: https://github.com/korbinian1233321-eng/pond/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/korbinian1233321-eng/pond/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/korbinian1233321-eng/pond/releases/tag/v0.1.0
