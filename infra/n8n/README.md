# 自架 n8n

給川果設計 LINE 助理系統使用的 n8n 部署設定：n8n + PostgreSQL + Caddy（自動 HTTPS）。

完整步驟見 [`docs/line-assistant/第一步-LINE串接n8n-建置指南.md`](../../docs/line-assistant/第一步-LINE串接n8n-建置指南.md)。

## 快速安裝

在一台全新的 Ubuntu 22.04／24.04 VPS 上：

```bash
sudo apt-get update && sudo apt-get install -y git
sudo git clone https://github.com/nicko751031-a11y/niddesign.git /opt/niddesign
cd /opt/niddesign/infra/n8n
sudo cp .env.example .env
sudo nano .env          # 填 N8N_HOST、ACME_EMAIL、LINE_CHANNEL_SECRET
sudo bash install.sh
```

安裝前請先把 `N8N_HOST` 的 DNS A 記錄指向這台機器，否則 Caddy 拿不到憑證。
若 DNS 走 Cloudflare，這一筆要設成 **DNS only**（關閉橘色雲朵）。

## 檔案說明

| 檔案 | 用途 |
|---|---|
| `docker-compose.yml` | 服務定義 |
| `Caddyfile` | 反向代理與自動 HTTPS |
| `.env.example` | 環境變數範本（`.env` 已被 gitignore） |
| `install.sh` | 一鍵安裝：Docker、防火牆、密碼產生、DNS 檢查、啟動 |
| `backup.sh` | 備份 PostgreSQL 與 `.env` |

## 維運

```bash
cd /opt/niddesign/infra/n8n

sudo docker compose ps                                   # 服務狀態
sudo docker compose logs -f n8n                          # 即時日誌
sudo docker compose restart n8n                          # 重啟
sudo docker compose pull && sudo docker compose up -d     # 升級 n8n
sudo bash backup.sh                                      # 手動備份
```

每日自動備份：

```cron
0 3 * * * /opt/niddesign/infra/n8n/backup.sh >> /var/log/nid-n8n-backup.log 2>&1
```

## ⚠️ 關於 N8N_ENCRYPTION_KEY

`.env` 裡的 `N8N_ENCRYPTION_KEY` 是 n8n 用來加密所有 Credential 的金鑰。

**遺失它，資料庫裡的 LINE Token、Notion Token、API Key、Dropbox 授權全部無法解密，只能重建。**

請把 `.env` 另外離線備份一份（例如密碼管理器）。只備份資料庫是不夠的。

## 這份設定做了哪些不預設的調整

| 設定 | 值 | 原因 |
|---|---|---|
| `N8N_BLOCK_ENV_ACCESS_IN_NODE` | `false` | 讓 Code 節點能讀 `$env.LINE_CHANNEL_SECRET` 做簽章驗證，密鑰因此不必寫在工作流裡 |
| `NODE_FUNCTION_ALLOW_BUILTIN` | `crypto` | 簽章驗證需要 `require('crypto')` 做 HMAC-SHA256 |
| `N8N_DEFAULT_BINARY_DATA_MODE` | `filesystem` | LINE 影片可能很大，走檔案系統而非記憶體 |
| `N8N_PAYLOAD_SIZE_MAX` | `256`（MB） | 同上 |
| `EXECUTIONS_DATA_MAX_AGE` | `336`（14 天） | 避免執行紀錄把資料庫塞爆 |
| `N8N_PROXY_HOPS` | `1` | 前面有 Caddy，讓 n8n 正確取得來源 IP |
