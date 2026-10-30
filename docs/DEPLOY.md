# 部署

目标：让中国大陆的人能正常打开。

这个约束会砍掉大部分「一键部署」方案，所以先把路走对，再动手。

---

## 一、机器放在哪

| 位置 | 备案 | 大陆延迟 | 结论 |
|---|---|---|---|
| 中国大陆 | **必须 ICP 备案** | 10–30ms | **走不通**，见下 |
| 中国香港 | 不需要 | 30–50ms | **推荐** |
| 新加坡 / 日本 | 不需要 | 60–100ms | 可以，比香港慢一档 |
| 美西 / 欧洲 | 不需要 | 150–250ms | 能开但明显卡，晚高峰更差 |
| Vercel / Netlify / Railway | — | — | **跑不了**，见下 |

### 为什么大陆服务器走不通

不是「慢」，是「堵死」。

备案只针对大陆节点，本身一到三周能等。问题是**论坛这个形态在备案里是特殊类别**：《互联网论坛社区服务管理规定》把论坛社区单独拎出来管，历史上需要 BBS 专项审批，通过率极低。个人备案不能开办论坛——不是审核慢，是这一类不在个人可办的范围里。

要合规地在大陆开论坛，基本要有企业主体，还要面对内容审核责任。对一个人做的社区，这不是一条现实的路。

### 为什么 Vercel / Netlify / Railway 跑不了

Pond 有三件事跟 serverless 天然冲突：

1. **常驻进程**：`node server.js` 一直在跑，serverless 是请求来了才起
2. **本地文件数据库**：SQLite 存在磁盘上，serverless 的文件系统是临时的，重启就没了
3. **SSE 长连接**：鱼汛靠一条不结束的 HTTP 响应推消息，serverless 有硬性超时

换成 Postgres + Redis 能解决前两个，但那就不是「零依赖」了。所以老老实实买台 VPS。

### 买什么

近期活动价，以官网为准：

| 商家 | 配置 | 价格 |
|---|---|---|
| 阿里云香港轻量 | 2核2G / 30M 峰值 / 超额 1 元每 GB | 288 元/年起 |
| 腾讯云香港轻量 | 2核2G / 30M 峰值 / 1TB 流量 | 约 24–30 元/月 |

2 核 2G 对一个小社区绰绰有余——Pond 单进程、内存占用几十 MB，瓶颈在带宽不在 CPU。

**域名**：在阿里云 / 腾讯云注册后要做**实名认证**，1–3 天。这跟备案是两件事，免备案不等于免实名。想快就先用 IP 访问，域名下来再切。

---

## 二、装起来

以下命令按 Ubuntu 22.04 / Debian 12 写。

### 1. Node 22

`node:sqlite` 需要 Node >= 22.5，系统源里的版本通常不够。

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node -v          # 要 >= 22.5
```

### 2. 拉代码

```bash
sudo useradd -r -s /usr/sbin/nologin -d /srv/pond pond
sudo mkdir -p /srv/pond && sudo chown pond:pond /srv/pond

sudo -u pond git clone https://github.com/korbinian1233321-eng/pond.git /srv/pond
cd /srv/pond
```

不需要 `npm install`——这是这个项目唯一的部署优势，别浪费它。

### 3. 配置

```bash
sudo -u pond cp .env.example .env
sudo -u pond nano .env
```

对公网必须改的几项：

```ini
POND_HOST=0.0.0.0
POND_PORT=3000
POND_BASE_URL=https://yu.example.com
POND_SECURE_COOKIE=1
POND_TRUST_PROXY=1
POND_ADMIN=你的账号名
POND_NO_SEED=1
```

逐个说为什么：

- **`POND_TRUST_PROXY=1`**：反代后面必须开，否则所有访客在应用眼里都是 `127.0.0.1`，一个人刷快了全站被限流。反过来说，**如果这个端口能被公网直接访问，就不能开**——客户端自己填 `X-Forwarded-For` 就能伪造 IP 绕过限流。所以下面第 5 步的防火墙不是可选项。
- **`POND_SECURE_COOKIE=1`**：走 HTTPS 时必须开，不然会话 Cookie 会跟着明文请求发出去。
- **`POND_BASE_URL`**：canonical 和 sitemap 用它拼网址。不设就从 `Host` 头推，反代配错时会给出不一致的网址，搜索引擎会当成两个站。
- **`POND_NO_SEED=1`**：不写入示例数据。示例数据里的 `admin / pond1234` 是公开密码。
- **`POND_ADMIN`**：写上你的账号名，注册即管理员。

### 4. systemd

```bash
sudo cp deploy/pond.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now pond
sudo systemctl status pond
journalctl -u pond -n 30 --no-pager
```

unit 文件里已经收紧了权限：整台机器对进程只读，只有 `/srv/pond/data` 可写。

启动日志会把还处于默认值的危险项列出来，看到 `⚠` 就回去改 `.env`。

### 5. 防火墙：3000 端口不要对外

```bash
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

3000 不开放。应用只监听在反代后面，这是 `POND_TRUST_PROXY=1` 能成立的前提。

### 6. Caddy 自动 HTTPS

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy

sudo cp deploy/Caddyfile /etc/caddy/Caddyfile
sudo nano /etc/caddy/Caddyfile          # 换成你的域名
sudo systemctl reload caddy
```

域名 A 记录要先解析到这台机器，否则证书签不下来。

Caddy 默认 `flush_interval -1`，SSE 事件会立刻出去。换 Nginx 的话要自己补 `proxy_buffering off` 和足够长的 `proxy_read_timeout`，不然鱼汛会变成「一分钟刷一次」。

---

## 三、上线后第一件事

**改掉管理员口令。**

```bash
cd /srv/pond
sudo -u pond node scripts/set-password.js 你的账号名
```

不给口令就随机生成一个，同时踢掉这个账号所有已登录的会话。忘了密码、或者怀疑被盗，都是这条命令。

```bash
sudo -u pond node scripts/set-password.js --list           # 看有哪些账号
sudo -u pond node scripts/set-password.js alice 新口令      # 指定口令
sudo -u pond node scripts/set-password.js alice --admin    # 顺手提成管理员
```

---

## 四、关于微信

这件事得提前知道，不然上线了会懵。

**微信里打开未备案的境外域名，有一定概率被拦。** 表现是红色页面「已停止访问该网页」，或者提示「该网页包含不安全内容」。触发原因包括域名历史、内容关键词、被举报，以及新域名本身的可信度低。

申诉路径存在，但要求企业主体核实，个人运营的站点很难走通。

所以现实是这样：

- 网址直接发出去，别人在**浏览器里打开**——没问题
- 发到微信群里让人点——**可能被拦**，尤其是新域名头几个月

绕的办法有几个，都不完美：让用户「复制到浏览器打开」、做个二维码、或者先用一段时间把域名养熟（有正常流量、有外链、内容干净）。

这是「在中国做社区」的固定成本，不是这个项目的问题。

---

## 五、备份

数据全在 `data/pond.db` 一个文件里。**不要直接 `cp`**——WAL 模式下可能漏掉还在日志里的数据。

```bash
sudo -u pond sqlite3 /srv/pond/data/pond.db ".backup '/srv/backup/pond-$(date +%F).db'"
```

放 cron 里每天跑一次，顺手把超过 30 天的删掉：

```bash
sudo crontab -u pond -e
```

```cron
20 4 * * * sqlite3 /srv/pond/data/pond.db ".backup '/srv/backup/pond-$(date +\%F).db'" && find /srv/backup -name 'pond-*.db' -mtime +30 -delete
```

`sqlite3` 要单独装：`sudo apt install -y sqlite3`。

---

## 六、检查清单

上线前过一遍：

- [ ] `node -v` >= 22.5
- [ ] `.env` 里 `POND_HOST=0.0.0.0`、`POND_TRUST_PROXY=1`、`POND_SECURE_COOKIE=1`、`POND_BASE_URL` 都设了
- [ ] `POND_NO_SEED=1`，或者已经改掉示例账号的口令
- [ ] 防火墙只开 22 / 80 / 443
- [ ] `https://你的域名/` 能开，地址栏是小锁
- [ ] `https://你的域名/p/随便一层楼` 关掉 JS 还能看到正文
- [ ] `https://你的域名/sitemap.xml` 里是**你的**域名，不是 `127.0.0.1`
- [ ] 鱼汛发一条消息，另一个浏览器立刻能看到
- [ ] 备份 cron 跑过一次，`/srv/backup` 里有文件

最后两条最容易忘，也最容易在出事时后悔。
