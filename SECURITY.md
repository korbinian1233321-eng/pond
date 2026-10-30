# 安全策略

## 报告漏洞

**请不要开公开 issue。**

用 GitHub 的私密漏洞报告：仓库页 → Security → Advisories → Report a vulnerability。

如果这个入口用不了，就发一封邮件给维护者（见 `package.json` 里的 author 字段），标题带上 `[Pond Security]`。

我尽量在 72 小时内回第一封。修好之后会在这里和 release notes 里写明，如果你想署名可以告诉我。

## 什么算安全问题

- 能读到别人的私密数据（会话、通知、未发布内容）
- 能绕过权限（普通成员做出只有版主能做的事）
- 能冒充别人（会话固定、CSRF、Cookie 处理错误）
- 能让服务不可用（放大攻击、SSE 连接耗尽的低成本打法、正则回溯）
- SQL 注入、路径穿越、XSS
- 依赖链问题（这个项目没有 npm 依赖，所以只可能出在 Node 本身）

**不算**：没有限流导致被刷（这是已知的）、没有二次验证（这是刻意的）、示例账号密码写在 README 里（这是演示数据，正式部署要求你删掉）。

## 已经做了什么

写在这里，是为了让你知道哪些地方已经防过了，可以把精力放在别处：

| 面向 | 措施 | 位置 |
|---|---|---|
| 口令 | scrypt + 每用户独立 salt，比对用 `crypto.timingSafeEqual` | `lib/auth.js` |
| 会话 | 32 字节随机 token，存数据库，HttpOnly + SameSite=Lax，30 天过期 | `lib/auth.js` |
| CSRF | 写接口强制 `Content-Type: application/json`，配合 SameSite=Lax 挡住表单提交 | `lib/api.js` |
| XSS（前端） | 所有插值走 `esc()`；全站 CSP 禁 inline script | `public/app.js` / `server.js` |
| XSS（服务端渲染） | 拼进 HTML 的用户内容同样走 `esc()`；JSON-LD 里的 `<` 转成 `\u003c`，防止提前闭合 `</script>` | `lib/render.js` |
| 点击劫持 | `X-Frame-Options: SAMEORIGIN` | `server.js` |
| MIME 嗅探 | `X-Content-Type-Options: nosniff` | `server.js` |
| 路径穿越 | 静态资源解析后校验前缀，越界返回 403 | `lib/http.js` |
| 请求体炸弹 | 256KB 上限，超了直接断开 | `lib/http.js` |
| 刷接口 | 按 IP 滑动窗口限流；鱼汛另有按账号的连接数上限 | `lib/http.js` / `lib/chat.js` |
| 伪造来源 IP | `X-Forwarded-For` 默认不采信，只有 `POND_TRUST_PROXY=1` 才读——否则客户端自己填这个头就能换着 IP 绕过所有限流 | `server.js` |
| 上传伪装文件 | 按文件头魔数判格式，`Content-Type` 和扩展名都不作数；改名成 `.png` 的脚本会被拒 | `lib/upload.js` |
| 上传 SVG | 直接拒。SVG 是 XML，能带 `<script>`，同源托管等于开 XSS 后门 | `lib/upload.js` |
| 上传路径穿越 | 文件名由服务端生成，`/uploads/` 只认 `f_[a-z0-9]+.(png\|jpg\|gif\|webp)`，其余 404 | `server.js` |
| 外链图片追踪 | 正文里只渲染 `/uploads/` 开头的图，外链 `![]()` 当普通文字，第三方拿不到读者 IP | `lib/render.js` / `public/app.js` |
| SQL 注入 | 全部走 `prepare` 占位符，没有字符串拼接用户输入 | `lib/api.js` |
| 越权 | 每个写接口都过 `needAuth()` / `needMod()` | `lib/api.js` |

## 部署时的安全清单

自托管项目，一半的安全取决于你怎么部署。上线前请确认：

- [ ] 前面挂了 HTTPS 反代，并设了 `POND_SECURE_COOKIE=1`
- [ ] 删掉了 `data/` 目录，用 `POND_NO_SEED=1` 启动（否则示例账号 `admin / pond1234` 会留在生产环境）
- [ ] 反代后面设了 `POND_TRUST_PROXY=1`，**并且**用防火墙挡住了 3000 端口
- [ ] 数据库文件不在 Web 根目录下（默认在 `data/`，本来就不对外）
- [ ] 定期备份 `pond.db` **和 `data/uploads/`**——只备份数据库的话，所有帖子里的图都会变成裂图

最后两条容易踩：`POND_TRUST_PROXY` 和防火墙必须一起做。只开信任不开防火墙，客户端可以直接连 3000 端口伪造 `X-Forwarded-For`，限流全废；只开防火墙不开信任，所有访客被算成 `127.0.0.1`，一个人能把全站限流掉。

启动日志会把这几种配置问题打出来，看到 `⚠` 就说明 `.env` 还没配好。

## 支持范围

只有 `main` 分支的最新提交会被修。这是个人维护的小项目，不提供多版本长期支持。
