#!/usr/bin/env bash
#
# Pond · Oracle Cloud 免费机一键安装
#
#   curl -fsSL https://raw.githubusercontent.com/korbinian1233321-eng/pond/main/deploy/oracle/install.sh -o install.sh
#   sudo bash install.sh --admin yourname
#
#   sudo bash install.sh --admin yourname --domain yu.example.com
#
# 参数：
#   --admin NAME     必填。这个账号注册后就是管理员，而且不需要邀请码
#   --domain DOMAIN  可选。填了就装 Caddy 自动签 HTTPS，Pond 只监听本机
#   --port N         可选。默认 3000，只在不装 Caddy 时有意义
#
# 脚本可以重复跑：更新代码、重装服务，但不会覆盖已有的 .env。
#
# 干的事：
#   1. 装 Node 22、git
#   2. 建 pond 用户，代码放 /srv/pond
#   3. 写 .env（首次）和 systemd unit
#   4. 放行防火墙（Oracle 的 Ubuntu 镜像自带一条 REJECT，必须插到它前面）
#   5. 装 Caddy（仅 --domain 时）
#   6. 每天 4:17 自动备份数据库和图片，留 7 份
#
# 不会做的事：不会替你去 Oracle 控制台点「安全列表」。那一步必须自己点，
# 详见 docs/DEPLOY.md。脚本跑完会再提醒一次。

set -euo pipefail

ADMIN=""
DOMAIN=""
PORT=3000
REPO="${POND_REPO:-https://github.com/korbinian1233321-eng/pond.git}"
SRV=/srv/pond
BACKUP=/srv/backup

# ---------- 输出 ----------
if [ -t 1 ]; then
  C_OK=$'\033[32m'; C_WARN=$'\033[33m'; C_ERR=$'\033[31m'; C_DIM=$'\033[2m'; C_END=$'\033[0m'
else
  C_OK=""; C_WARN=""; C_ERR=""; C_DIM=""; C_END=""
fi
say()  { printf '%s\n' "$*"; }
step() { printf '\n%s==>%s %s\n' "$C_OK" "$C_END" "$*"; }
warn() { printf '%s  !%s %s\n' "$C_WARN" "$C_END" "$*"; }
die()  { printf '%s  ✗%s %s\n' "$C_ERR" "$C_END" "$*" >&2; exit 1; }

# ---------- 参数 ----------
while [ $# -gt 0 ]; do
  case "$1" in
    --admin)  ADMIN="${2:-}"; shift 2 ;;
    --domain) DOMAIN="${2:-}"; shift 2 ;;
    --port)   PORT="${2:-}"; shift 2 ;;
    -h|--help)
      sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) die "不认识的参数：$1（用 --help 看用法）" ;;
  esac
done

# ---------- 前置检查 ----------
[ "$(id -u)" -eq 0 ] || die "要用 root 跑：sudo bash $0 --admin 你的账号名"
[ -n "$ADMIN" ] || die "缺 --admin。这是你注册时用的账号名，例如 --admin yourname"

ADMIN="$(printf '%s' "$ADMIN" | tr '[:upper:]' '[:lower:]')"
if ! printf '%s' "$ADMIN" | grep -Eq '^[a-z0-9_-]{3,24}$'; then
  die "账号名只能用 3–24 位小写字母、数字、下划线或短横线"
fi

if [ -r /etc/os-release ]; then
  . /etc/os-release
  case "${ID:-}" in
    ubuntu|debian) : ;;
    ol|rhel|centos|rocky|almalinux)
      die "这个脚本是给 Ubuntu 写的。Oracle 开机时镜像选「Canonical Ubuntu 24.04」，别选 Oracle Linux。" ;;
    *) warn "没认出来的系统（${ID:-未知}），继续，但可能要手动补依赖" ;;
  esac
fi

[ "$(uname -m)" = "x86_64" ] || [ "$(uname -m)" = "aarch64" ] \
  || die "只支持 x86_64 和 aarch64，当前是 $(uname -m)"

export DEBIAN_FRONTEND=noninteractive

# ---------- 1. 依赖 ----------
step "装基础依赖"
apt-get update -qq
apt-get install -y -qq curl ca-certificates git gnupg >/dev/null

# ---------- 2. Node 22 ----------
step "装 Node 22"
need_node=1
if command -v node >/dev/null 2>&1; then
  # node:sqlite 要 22.5 以上，22.0 也不算数
  ok="$(node -p 'const [a,b]=process.versions.node.split(".").map(Number);(a>22||(a===22&&b>=5))?"1":"0"' 2>/dev/null || echo 0)"
  if [ "$ok" = "1" ]; then
    say "  已有 Node $(node -v)，跳过"
    need_node=0
  fi
fi
if [ "$need_node" -eq 1 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x -o /tmp/nodesource.sh
  bash /tmp/nodesource.sh >/dev/null 2>&1
  apt-get install -y -qq nodejs >/dev/null
fi
NODE_BIN="$(command -v node)"
node -e 'const [a,b]=process.versions.node.split(".").map(Number); if(a<22||(a===22&&b<5)) { console.error("Node 版本还是太低，需要 >= 22.5（node:sqlite）"); process.exit(1) }'
say "  $("$NODE_BIN" -v)  $NODE_BIN"

# ---------- 3. 用户与代码 ----------
step "准备 $SRV"
if ! id pond >/dev/null 2>&1; then
  useradd --system --create-home --home-dir "$SRV" --shell /usr/sbin/nologin pond
  say "  建了 pond 用户"
fi
mkdir -p "$SRV" "$BACKUP"

if [ -d "$SRV/.git" ]; then
  say "  已有代码，拉最新"
  git -C "$SRV" fetch --quiet origin main
  git -C "$SRV" reset --hard --quiet origin/main
else
  # 目录里可能只有我们刚 mkdir 的空壳，clone 要求目录为空
  if [ -n "$(ls -A "$SRV" 2>/dev/null || true)" ]; then
    die "$SRV 不是空目录，也不是 git 仓库。清空它再跑，或者手动 clone 进去。"
  fi
  say "  拉代码"
  git clone --quiet --depth 1 "$REPO" "$SRV"
fi
mkdir -p "$SRV/data"

# ---------- 4. .env ----------
step "写配置"
# 改一行已有配置。键不存在就追加。
set_env() {
  local k="$1" v="$2"
  if grep -q "^${k}=" "$SRV/.env"; then
    sed -i "s|^${k}=.*|${k}=${v}|" "$SRV/.env"
  else
    printf '%s=%s\n' "$k" "$v" >> "$SRV/.env"
  fi
}

if [ -f "$SRV/.env" ]; then
  say "  .env 已存在，保留不动"
  if ! grep -q "^POND_ADMIN=" "$SRV/.env"; then
    warn ".env 里没有 POND_ADMIN，补上 $ADMIN"
    printf '\nPOND_ADMIN=%s\n' "$ADMIN" >> "$SRV/.env"
  fi
  # 先跑过无域名、后来才加域名的：反代那几项必须跟着改，
  # 否则 Caddy 把请求转进来，应用还以为自己是直接对外的——
  # 所有人会被算成 127.0.0.1（限流互相拖累），Cookie 也不会带 Secure。
  if [ -n "$DOMAIN" ]; then
    set_env POND_HOST 127.0.0.1
    set_env POND_BASE_URL "https://$DOMAIN"
    set_env POND_TRUST_PROXY 1
    set_env POND_SECURE_COOKIE 1
    say "  已切到反代模式（POND_HOST / POND_BASE_URL / POND_TRUST_PROXY / POND_SECURE_COOKIE）"
  fi
else
  if [ -n "$DOMAIN" ]; then
    HOST_BIND=127.0.0.1
    BASE_URL="https://$DOMAIN"
    TRUST_PROXY=1
    SECURE_COOKIE=1
  else
    HOST_BIND=0.0.0.0
    PUBLIC_IP="$(curl -fsS --max-time 5 https://api.ipify.org 2>/dev/null || true)"
    if [ -n "$PUBLIC_IP" ]; then
      BASE_URL="http://$PUBLIC_IP:$PORT"
    else
      BASE_URL=""
      warn "没能自动识别公网 IP，POND_BASE_URL 先留空，稍后自己填"
    fi
    TRUST_PROXY=0
    SECURE_COOKIE=0
  fi

  cat > "$SRV/.env" <<EOF
# 由 deploy/oracle/install.sh 生成。改完记得 systemctl restart pond
POND_HOST=$HOST_BIND
POND_PORT=$PORT
POND_DATA_DIR=$SRV/data
POND_BASE_URL=$BASE_URL

# 这个账号注册后就是管理员，而且不需要邀请码
POND_ADMIN=$ADMIN

# 不写示例数据（示例里的 admin / pond1234 是公开密码）
POND_NO_SEED=1

# 邀请制。第一个码用 node scripts/invite.js new 生成
POND_REGISTRATION=invite

# 图片默认关。想要就改成 1
POND_IMAGES=0

POND_TRUST_PROXY=$TRUST_PROXY
POND_SECURE_COOKIE=$SECURE_COOKIE
EOF
  say "  写了 $SRV/.env"
fi

chown -R pond:pond "$SRV" "$BACKUP"
chmod 600 "$SRV/.env"

# ---------- 5. systemd ----------
step "装 systemd 服务"
install -m 644 "$SRV/deploy/pond.service" /etc/systemd/system/pond.service
systemctl daemon-reload
systemctl enable --quiet pond
systemctl restart pond
sleep 2
if systemctl is-active --quiet pond; then
  say "  pond 已启动"
else
  warn "pond 没起来，下面是最近 30 行日志："
  journalctl -u pond -n 30 --no-pager || true
fi

# ---------- 6. 防火墙 ----------
# Oracle 的 Ubuntu 镜像在 iptables 末尾挂了一条 REJECT，新端口必须插到它前面。
# 这只是机器自己的防火墙，云上还有一层「安全列表」，那个得去控制台点。
step "放行防火墙"
if ! command -v iptables >/dev/null 2>&1; then
  warn "没有 iptables，跳过。确认机器上别的防火墙已经放行"
else
open_port() {
  local p="$1"
  if ! iptables -C INPUT -p tcp --dport "$p" -j ACCEPT 2>/dev/null; then
    iptables -I INPUT 1 -p tcp --dport "$p" -j ACCEPT
    say "  iptables 放行 $p/tcp"
  fi
  if command -v ip6tables >/dev/null 2>&1; then
    if ! ip6tables -C INPUT -p tcp --dport "$p" -j ACCEPT 2>/dev/null; then
      ip6tables -I INPUT 1 -p tcp --dport "$p" -j ACCEPT 2>/dev/null || true
    fi
  fi
}

if [ -n "$DOMAIN" ]; then
  open_port 80
  open_port 443
else
  open_port "$PORT"
fi

# 让规则活过重启
if command -v netfilter-persistent >/dev/null 2>&1; then
  netfilter-persistent save >/dev/null 2>&1 || true
elif [ -d /etc/iptables ]; then
  iptables-save > /etc/iptables/rules.v4 2>/dev/null || true
  command -v ip6tables-save >/dev/null 2>&1 && ip6tables-save > /etc/iptables/rules.v6 2>/dev/null || true
else
  warn "没找到保存 iptables 的办法，重启后可能要重新放行"
fi
fi

# ---------- 7. Caddy（可选） ----------
if [ -n "$DOMAIN" ]; then
  step "装 Caddy 并签 HTTPS 证书"
  if ! command -v caddy >/dev/null 2>&1; then
    apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https >/dev/null
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
      | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
      > /etc/apt/sources.list.d/caddy-stable.list
    apt-get update -qq
    apt-get install -y -qq caddy >/dev/null
  fi

  mkdir -p /var/log/caddy
  chown -R caddy:caddy /var/log/caddy

  # 沿用仓库里那份 Caddyfile，只把域名换掉
  sed "s/^yu\.example\.com {/$DOMAIN {/" "$SRV/deploy/Caddyfile" > /etc/caddy/Caddyfile

  systemctl enable --quiet caddy
  systemctl reload caddy 2>/dev/null || systemctl restart caddy
  say "  Caddyfile 已写入，域名 $DOMAIN"

  # 证书签不下来最常见的原因就是 DNS 还没生效
  if getent hosts "$DOMAIN" >/dev/null 2>&1; then
    say "  $DOMAIN 能解析，等 Caddy 自己签证书（一般 10–30 秒）"
  else
    warn "$DOMAIN 还解析不出来。先把 A 记录指到这台机器的公网 IP，再 systemctl reload caddy"
  fi
fi

# ---------- 8. 备份 ----------
step "装每日备份"
cat > /etc/cron.d/pond-backup <<EOF
# 每天 4:17 备份数据库和图片，留 7 份
17 4 * * * pond $NODE_BIN --disable-warning=ExperimentalWarning $SRV/scripts/backup.js $BACKUP >/dev/null 2>&1
EOF
chmod 644 /etc/cron.d/pond-backup
say "  已写入 /etc/cron.d/pond-backup（备份到 $BACKUP）"

# ---------- 9. 收尾 ----------
if [ -n "$DOMAIN" ]; then
  FINAL_URL="https://$DOMAIN"
else
  FINAL_URL=$(grep '^POND_BASE_URL=' "$SRV/.env" | cut -d= -f2-)
  [ -n "$FINAL_URL" ] || FINAL_URL="http://<这台机器的公网IP>:$PORT"
fi

cat <<EOF

$(printf '%s' "$C_OK")装完了。$C_END

  地址    $FINAL_URL
  管理员  $ADMIN
  代码    $SRV
  数据    $SRV/data
  备份    $BACKUP（每天 4:17，留 7 份）

$(printf '%s' "$C_WARN")还有两步必须自己做：$C_END

  1. Oracle 控制台 → 你的实例 → 子网 → 安全列表 → 添加入站规则
     $( [ -n "$DOMAIN" ] && echo "放行 TCP 80 和 443" || echo "放行 TCP $PORT" )
     机器自己的 iptables 我已经放行了，但云上这一层脚本改不了。
     不开这个，浏览器会一直转圈，看起来像服务没起。

  2. 打开上面的地址，用「$ADMIN」注册。
     这个账号不需要邀请码，注册完就是管理员。

  然后发第一个邀请码：

     cd $SRV
     sudo -u pond $NODE_BIN scripts/invite.js new --note "给第一个朋友"

  看日志：   journalctl -u pond -f
  重启：     systemctl restart pond
  改配置：   编辑 $SRV/.env 后 systemctl restart pond
  手动备份： sudo -u pond $NODE_BIN $SRV/scripts/backup.js

EOF

if [ -z "$DOMAIN" ]; then
  cat <<EOF
$(printf '%s' "$C_WARN")现在走的是 HTTP，密码和邀请码是明文传输的。$C_END
  自己人小范围用可以，但别当长期方案。想要 HTTPS 又不想买域名，
  可以先去 dpdns.org / nic.eu.org 申请一个免费二级域名，解析过来之后跑：

     sudo bash $0 --admin $ADMIN --domain 你的免费域名

  脚本是幂等的，重跑只会补上 Caddy，不会动你的数据。

EOF
fi
