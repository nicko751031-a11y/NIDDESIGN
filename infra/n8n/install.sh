#!/usr/bin/env bash
# ============================================================
# 川果設計 NID DESIGN LAB｜自架 n8n 一鍵安裝
# 適用：全新的 Ubuntu 22.04 / 24.04 LTS VPS，以 root 或 sudo 執行
# 用法：sudo bash install.sh
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

info() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m[!] %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31m[x] %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "請用 root 或 sudo 執行"

# ---------- 1. Docker ----------
if command -v docker >/dev/null 2>&1; then
  info "Docker 已安裝，略過"
else
  info "安裝 Docker Engine 與 Compose plugin"
  apt-get update -qq
  apt-get install -y -qq ca-certificates curl gnupg openssl
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
    | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  systemctl enable --now docker
fi

# ---------- 2. 防火牆 ----------
if command -v ufw >/dev/null 2>&1; then
  info "設定防火牆（開放 22 / 80 / 443）"
  ufw allow 22/tcp  >/dev/null 2>&1 || true
  ufw allow 80/tcp  >/dev/null 2>&1 || true
  ufw allow 443/tcp >/dev/null 2>&1 || true
  ufw --force enable >/dev/null 2>&1 || true
fi

# ---------- 3. .env ----------
if [ ! -f .env ]; then
  info "建立 .env 並自動產生密碼"
  cp .env.example .env
  ENC_KEY="$(openssl rand -hex 32)"
  PG_PW="$(openssl rand -base64 24 | tr -d '/+=' | head -c 32)"
  sed -i "s|^N8N_ENCRYPTION_KEY=.*|N8N_ENCRYPTION_KEY=${ENC_KEY}|" .env
  sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=${PG_PW}|" .env
  chmod 600 .env
  warn "已產生 .env。請務必手動填寫 N8N_HOST、ACME_EMAIL、LINE_CHANNEL_SECRET 後再繼續。"
  warn "請把 .env 離線備份一份（含 N8N_ENCRYPTION_KEY，遺失無法復原憑證）。"
else
  info ".env 已存在，保留不動"
fi

# ---------- 4. 必填檢查 ----------
# shellcheck disable=SC1091
set -a; . ./.env; set +a
[ -n "${N8N_HOST:-}" ]            || die ".env 的 N8N_HOST 未填"
[ -n "${ACME_EMAIL:-}" ]          || die ".env 的 ACME_EMAIL 未填"
[ -n "${N8N_ENCRYPTION_KEY:-}" ]  || die ".env 的 N8N_ENCRYPTION_KEY 未填"
[ -n "${POSTGRES_PASSWORD:-}" ]   || die ".env 的 POSTGRES_PASSWORD 未填"
[ -n "${LINE_CHANNEL_SECRET:-}" ] || warn "LINE_CHANNEL_SECRET 尚未填寫，簽章驗證會失敗（可稍後補上再 docker compose up -d）"

# ---------- 5. DNS 檢查 ----------
info "檢查 DNS：${N8N_HOST}"
RESOLVED="$(getent hosts "$N8N_HOST" | awk '{print $1}' | head -1 || true)"
PUBIP="$(curl -fsS --max-time 10 https://api.ipify.org || true)"
if [ -z "$RESOLVED" ]; then
  warn "${N8N_HOST} 還沒有 DNS 記錄。Caddy 會拿不到憑證，請先到網域商設定 A 記錄指向 ${PUBIP:-本機public IP}。"
elif [ -n "$PUBIP" ] && [ "$RESOLVED" != "$PUBIP" ]; then
  warn "DNS 指向 ${RESOLVED}，但本機對外 IP 是 ${PUBIP}，兩者不同，憑證可能簽發失敗。"
else
  info "DNS 正確指向本機（${RESOLVED}）"
fi

# ---------- 6. 啟動 ----------
info "拉取映像檔並啟動"
docker compose pull
docker compose up -d

info "等待服務就緒"
for _ in $(seq 1 30); do
  if docker compose ps --format '{{.Service}} {{.State}}' | grep -q 'n8n running'; then break; fi
  sleep 2
done

docker compose ps

cat <<EOF

============================================================
 完成。接下來：

 1. 開啟 https://${N8N_HOST}/ 建立 n8n 管理員帳號
    （首次簽發憑證約需 10-30 秒，若顯示憑證錯誤請稍候重整）

 2. 匯入工作流：n8n 右上 ... → Import from File
    檔案：n8n/workflows/01-line-ingest.json
          n8n/workflows/02-error-handler.json

 3. 依照 docs/line-assistant/第一步-LINE串接n8n-建置指南.md
    建立 4 組 Credential，然後把 Webhook URL 貼到 LINE Console

 常用指令：
   docker compose logs -f n8n     # 看即時日誌
   docker compose restart n8n     # 重啟
   docker compose pull && docker compose up -d   # 升級 n8n
   bash backup.sh                 # 備份
============================================================
EOF
