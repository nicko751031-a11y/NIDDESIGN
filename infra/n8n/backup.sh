#!/usr/bin/env bash
# 備份 n8n 資料庫與 .env。建議設成每日 cron：
#   0 3 * * * /opt/nid-n8n/backup.sh >> /var/log/nid-n8n-backup.log 2>&1
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"
BACKUP_DIR="${BACKUP_DIR:-$SCRIPT_DIR/backups}"
KEEP_DAYS="${KEEP_DAYS:-30}"
STAMP="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"

set -a; . ./.env; set +a

docker compose exec -T postgres pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" \
  | gzip > "$BACKUP_DIR/n8n-db-$STAMP.sql.gz"

# .env 內含 N8N_ENCRYPTION_KEY，沒有它資料庫裡的憑證無法解密，必須一起備份
cp .env "$BACKUP_DIR/env-$STAMP.bak"
chmod 600 "$BACKUP_DIR/env-$STAMP.bak"

find "$BACKUP_DIR" -type f -mtime "+$KEEP_DAYS" -delete
echo "[$(date '+%F %T')] 備份完成：$BACKUP_DIR/n8n-db-$STAMP.sql.gz"
