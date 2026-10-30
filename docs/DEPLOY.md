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
| Oracle 免费机（东京/首尔） | 不需要 | 60–100ms | **一分钱不花**，见一·B |
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

## 一·B、一分钱不花：Oracle 永久免费机

不想买机器的话，Oracle Cloud 的 Always Free 是唯一真·永久免费的选项（AWS / Azure / GCP 的免费期都是 12 个月，或者只有几个美国区）。Pond 的「一个进程 + 一个 SQLite 文件」正好吃得住最小配置。

### 能白拿多少

| 资源 | 额度 |
|---|---|
| `VM.Standard.E2.1.Micro`（AMD） | **2 台**，1 核 1G |
| `VM.Standard.A1.Flex`（ARM） | 合计 2 核 12G（2026 年 9 月从 4 核 24G 砍下来的） |
| 块存储 | 200 GB |
| 出站流量 | 每月 10 TB |

**别去抢 ARM。** 网上教程全是「4 核 24G 的 Ampere」，这就是「Out of host capacity」刷屏的来源——现在配额还砍半了。那台 **1 核 1G 的 x86 Micro 基本随开随有**，而 Pond 跑起来只占几十兆内存，完全够。

### 代价

- 注册要手机号 + 信用卡。官方明说：**不主动升级就不会扣款**。
- 开机时选的**主区域不能改**，而且免费实例只能建在主区域。所以选之前想清楚：日本东部（东京）或韩国首尔离国内最近，南韩春川（Chuncheon）没有 ARM。
- 闲置回收：7 天内 CPU / 网络持续低于 20% 可能被收走。有真实访问就不会触发，纯放着不管的新站有这个风险。

### 开机器

1. 注册，主区域选 **Japan East (Tokyo)** 或 **South Korea Central (Seoul)**
2. 创建实例 → 镜像选 **Canonical Ubuntu 24.04**（不要选 Oracle Linux，下面的脚本是给 Ubuntu 写的）
3. Shape 选 **VM.Standard.E2.1.Micro**（AMD），1 核 1G
4. 下载 SSH 私钥，记下公网 IP
5. SSH 进去，跑一条命令

```bash
# 有域名
curl -fsSL https://raw.githubusercontent.com/korbinian1233321-eng/pond/main/deploy/oracle/install.sh -o install.sh
sudo bash install.sh --admin 你的账号名 --domain yu.example.com

# 没域名，先用 IP 访问
sudo bash install.sh --admin 你的账号名
```

脚本干这些：装 Node 22 → 建 `pond` 用户 → 拉代码到 `/srv/pond` → 写 `.env` → 装 systemd → 放行 iptables → （有域名时）装 Caddy 签证书 → 每天 4:17 自动备份。

可以重复跑：更新代码、重装服务，但不会覆盖已有的 `.env`（加 `--domain` 重跑时，会帮你把反代相关的四项改成正确值）。

### 脚本改不了的那一步

**Oracle 控制台 → 实例 → 子网 → 安全列表 → 添加入站规则**，放行 TCP 80/443（或 3000）。

机器自己的 iptables 脚本放行了，云上这一层放行不了——这是新手最常卡住的地方，症状是浏览器一直转圈，看起来像服务没起来，其实请求根本没到机器。

### 然后

用 `--admin` 那个账号注册（不需要邀请码，注册完就是管理员），然后发第一个码：

```bash
cd /srv/pond
sudo -u pond node scripts/invite.js new --note "给第一个朋友"
```

### 没有域名怎么上 HTTPS

先用 IP + HTTP 跑起来，自己人小范围用没问题，但**密码和邀请码是明文传输的**，别当长期方案。

想零成本解决，去申请一个免费二级域名（`dpdns.org`、`nic.eu.org` 这些，人工审核、永久免费），A 记录指到机器 IP，然后重跑一次脚本：

```bash
sudo bash install.sh --admin 你的账号名 --domain 你的免费域名
```

Caddy 会自动签证书并续期。

> Let's Encrypt 从 2026 年 1 月起支持**给 IP 地址签证书**了，理论上不买域名也能有 HTTPS。但那套证书只有 6 天有效期、必须走 `shortlived` profile，Caddy 对 IP 默认只用自己的内部 CA，配起来比申请个免费域名还麻烦。想折腾的话自己接 certbot，我不推荐把它当作第一步。

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
POND_REGISTRATION=invite
```

逐个说为什么：

- **`POND_TRUST_PROXY=1`**：反代后面必须开，否则所有访客在应用眼里都是 `127.0.0.1`，一个人刷快了全站被限流。反过来说，**如果这个端口能被公网直接访问，就不能开**——客户端自己填 `X-Forwarded-For` 就能伪造 IP 绕过限流。所以下面第 5 步的防火墙不是可选项。
- **`POND_SECURE_COOKIE=1`**：走 HTTPS 时必须开，不然会话 Cookie 会跟着明文请求发出去。
- **`POND_BASE_URL`**：canonical 和 sitemap 用它拼网址。不设就从 `Host` 头推，反代配错时会给出不一致的网址，搜索引擎会当成两个站。
- **`POND_NO_SEED=1`**：不写入示例数据。示例数据里的 `admin / pond1234` 是公开密码。
- **`POND_ADMIN`**：写上你的账号名，注册即管理员，而且**不用邀请码**——不然新站一个码都没有，你自己也进不去。
- **`POND_REGISTRATION=invite`**：默认就是这个值，写出来是为了防止哪天被环境变量覆盖成 `open`。对公网的塘开着开放注册，第一个周末就会被注册机扫到。

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

**然后发第一个邀请码。**

`POND_ADMIN` 那个账号注册时不需要码，但别人需要。两个办法：

```bash
# 在服务器上发，最省事
sudo -u pond node scripts/invite.js new --note "给阿金"

# 或者登录后进「我的鱼档」，页面上有邀请面板，点「生成一个」
```

面板里能看见每个码是可用、已用还是过期，发错了点 × 撤回。码只能用一次，14 天后自动作废，普通成员同时最多囤 3 个——想要更多就等手上的被用掉。

`node scripts/invite.js list` 看全部码，`revoke ABCD-EFGH` 撤掉发错的。

> 码长这样：`ABCD-EFGH`。去掉了 `I L O 0 1`，因为截图和手抄时这几个最容易认错。小写、多打空格、漏打横线都认。

想改成开放注册（不建议）：

```bash
sudo -u pond sed -i 's/^POND_REGISTRATION=.*/POND_REGISTRATION=open/' .env
sudo systemctl restart pond
```

完全关门（`closed`）之后，网页上没有任何注册入口，只能从服务器建号：

```bash
sudo -u pond node scripts/add-user.js ajin --fish 青柠气泡
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

数据在 `data/` 目录里：`pond.db` 是内容，`uploads/` 是图片。**两个都要备。**

只备数据库的话，帖子里的图会全部变成裂图——文件名还在，文件没了。

`pond.db` **不要直接 `cp`**——WAL 模式下可能漏掉还在日志里的数据。

```bash
sudo -u pond sqlite3 /srv/pond/data/pond.db ".backup '/srv/backup/pond-$(date +%F).db'"
sudo -u pond rsync -a --delete /srv/pond/data/uploads/ /srv/backup/uploads/
```

放 cron 里每天跑一次，顺手把超过 30 天的数据库快照删掉：

```bash
sudo crontab -u pond -e
```

```cron
20 4 * * * sqlite3 /srv/pond/data/pond.db ".backup '/srv/backup/pond-$(date +\%F).db'" && rsync -a /srv/pond/data/uploads/ /srv/backup/uploads/ && find /srv/backup -name 'pond-*.db' -mtime +30 -delete
```

`sqlite3` 要单独装：`sudo apt install -y sqlite3`。

图片用 `rsync` 而不是每天一份完整快照——它们不会变（文件名带随机 id），同步一次就够了，不用占 30 倍的磁盘。

---

## 六、检查清单

上线前过一遍：

- [ ] `node -v` >= 22.5
- [ ] `.env` 里 `POND_HOST=0.0.0.0`、`POND_TRUST_PROXY=1`、`POND_SECURE_COOKIE=1`、`POND_BASE_URL` 都设了
- [ ] `POND_NO_SEED=1`，或者已经改掉示例账号的口令
- [ ] `POND_REGISTRATION=invite`，而且 `node scripts/invite.js list` 里至少有一个能用的码
- [ ] 退出登录，试着不带码注册一次——应该被拦住，而不是真的建出账号
- [ ] 防火墙只开 22 / 80 / 443
- [ ] `https://你的域名/` 能开，地址栏是小锁
- [ ] `https://你的域名/p/随便一层楼` 关掉 JS 还能看到正文
- [ ] `https://你的域名/sitemap.xml` 里是**你的**域名，不是 `127.0.0.1`
- [ ] 鱼汛发一条消息，另一个浏览器立刻能看到
- [ ] 备份 cron 跑过一次，`/srv/backup` 里有 db **和 uploads**

最后两条最容易忘，也最容易在出事时后悔。
