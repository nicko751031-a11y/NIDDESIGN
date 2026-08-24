# 代管 n8n 部署｜Railway

文件版本：2026-08-24
對象：不想管伺服器的人
預估時間：**20–30 分鐘**
需要：GitHub 帳號、信用卡

這是「不自己開 VPS」的部署方式。跟自架版比起來，你**不用**做這些事：

- 開 VPS、SSH 連線、跑 Docker 指令
- 設 DNS A 記錄（用 Railway 給的網址，WordPress.com 完全不用動）
- 自己設定 HTTPS 憑證、寫備份 cron

**功能完全一樣**：底層仍是完整的自架版 n8n，所以工作流 JSON 一行都不用改，
執行次數也沒有上限（這是 n8n Cloud 沒有的）。

> 想要完整掌控、或長期成本最低，請改看
> [`VPS開通與DNS設定-逐步操作.md`](VPS開通與DNS設定-逐步操作.md)。兩者擇一即可。

---

## 0. 關於費用與替代方案

Railway 是用量計費，n8n 這種長時間掛著但負載很輕的服務，實務上大約落在
**每月 US$5–15**（約 NT$160–500）。需要付費方案（Hobby 起），
**不要用免費試用額度跑正式服務**——額度用完服務會停，LINE 訊息就漏接了。

其他同類型服務，如果你之後想換：

| 服務 | 特色 |
|---|---|
| **Railway**（本文件） | 最便宜，介面清楚，設定彈性大 |
| Elestio | 一鍵安裝 n8n，連更新與備份都幫你做，但較貴 |
| Sliplane | 專做 Docker 代管，價格固定好抓 |
| Render | 名氣大，但免費方案會休眠，**不適合接 Webhook** |

實際方案內容與價格請以各家官網為準。

---

## 1. 註冊 Railway

1. 開 <https://railway.com/> → **Login** → 用 **GitHub 登入**（最快）
2. 進入後到 **Account Settings → Plans**，升級到 **Hobby**（US$5／月起）

> ⚠️ Railway 內建的 **AI Agent（右側面板）會另外計費**。
> 底下的步驟自己點就好，不需要用 Agent。

---

## 2. 建立專案與資料庫

1. 首頁按 **New Project**
2. 選 **Deploy PostgreSQL**（或 `Provision PostgreSQL`）
3. 等它跑完，畫面上會出現一個叫 **`Postgres`** 的服務方塊

> **服務名稱請保持 `Postgres`**。等一下的環境變數會用 `${{Postgres.PGHOST}}`
> 這種寫法去引用它，改名的話那些變數就對不上。

---

## 3. 加入 n8n 服務

1. 在同一個專案畫面按 **New**（或右上 `+ Create`）
2. 選 **Empty Service** →（或 **Docker Image**）
3. 進入該服務 → **Settings → Source**，把映像檔設成：

   ```text
   n8nio/n8n:latest
   ```

4. 服務名稱可改成 `n8n`

> 這是 Docker Hub 上的官方映像檔。n8n 自家的 `docker.n8n.io/n8nio/n8n:latest`
> 內容相同，但 Docker Hub 這個路徑在 Railway 上解析最穩。

---

## 4. 設定網址

1. 在 n8n 服務裡 → **Settings → Networking**
2. **Public Networking** → 按 **Generate Domain**
3. 若它問 **port**，填 **`5678`**

畫面會顯示 **「Public domain will be generated」**——這是正常的，
**網址要等按下 Deploy 之後才會真的產生**。

**你不需要事先知道網址是什麼。** 第 6 節的環境變數用 Railway 的內建變數
`${{RAILWAY_PUBLIC_DOMAIN}}` 自我引用，部署時會自動代換成實際網址。

> 部署完成後回到 **Settings → Networking** 就看得到實際網址，
> 類似 `n8n-production-a1b2.up.railway.app`。加到書籤即可；
> 不好記沒關係，LINE 不在乎網址好不好看。

---

## 5. 產生加密金鑰

在你電腦的 PowerShell 執行，產生一組 64 位元隨機字串：

```powershell
-join ((1..64) | ForEach-Object { '{0:x}' -f (Get-Random -Maximum 16) })
```

複製結果備用。

> ⚠️ **這組金鑰請立刻存進密碼管理器。** n8n 用它加密所有 Credential，
> 遺失的話 LINE Token、Notion Token、Anthropic Key、Dropbox 授權全部解不開，只能重建。

---

## 6. 填入環境變數（最關鍵的一步）

1. n8n 服務 → **Variables** 分頁
2. 找 **Raw Editor**（通常在右上角的 `⋮` 或 `RAW Editor` 按鈕）
3. **整段貼上**下面內容，然後只改**兩個**地方（網址那三行不用動）：

```ini
DB_TYPE=postgresdb
DB_POSTGRESDB_HOST=${{Postgres.PGHOST}}
DB_POSTGRESDB_PORT=${{Postgres.PGPORT}}
DB_POSTGRESDB_DATABASE=${{Postgres.PGDATABASE}}
DB_POSTGRESDB_USER=${{Postgres.PGUSER}}
DB_POSTGRESDB_PASSWORD=${{Postgres.PGPASSWORD}}

N8N_HOST=${{RAILWAY_PUBLIC_DOMAIN}}
WEBHOOK_URL=https://${{RAILWAY_PUBLIC_DOMAIN}}/
N8N_EDITOR_BASE_URL=https://${{RAILWAY_PUBLIC_DOMAIN}}/
N8N_PORT=5678
N8N_PROTOCOL=https
N8N_PROXY_HOPS=1

N8N_ENCRYPTION_KEY=請換成第5節產生的金鑰
LINE_CHANNEL_SECRET=請換成LINE的ChannelSecret

N8N_BLOCK_ENV_ACCESS_IN_NODE=false
NODE_FUNCTION_ALLOW_BUILTIN=crypto

GENERIC_TIMEZONE=Asia/Taipei
TZ=Asia/Taipei
N8N_DIAGNOSTICS_ENABLED=false
N8N_PERSONALIZATION_ENABLED=false
N8N_VERSION_NOTIFICATIONS_ENABLED=false
N8N_RUNNERS_ENABLED=true

EXECUTIONS_DATA_PRUNE=true
EXECUTIONS_DATA_MAX_AGE=336
N8N_DEFAULT_BINARY_DATA_MODE=filesystem
N8N_PAYLOAD_SIZE_MAX=256

NOTION_DB_GROUPS=e8151c00-4fdb-4496-8b04-5b91b6cc018d
NOTION_DB_FILES=32903708-fccf-48a0-b219-767da737f0ea
NOTION_DB_MESSAGES=687c5006-5421-4692-a9d9-5ff390a9c55a
```

### 只有這兩個要你填

| 變數 | 填什麼 | 去哪拿 |
|---|---|---|
| `N8N_ENCRYPTION_KEY` | 第 5 節產生的隨機字串 | PowerShell |
| `LINE_CHANNEL_SECRET` | Channel secret | [LINE Console → Basic settings](https://developers.line.biz/console/channel/2010874992/basic-info) |

其餘**原封不動**，包括這兩種 Railway 語法：

- `${{Postgres.PGHOST}}` 等六行 → 自動帶入資料庫連線資訊
- `${{RAILWAY_PUBLIC_DOMAIN}}` → 自動帶入本服務的公開網址，
  日後換成自訂網域也會自動跟著變，不用回來改

> 若部署後發現 n8n 的網址怪怪的（例如登入後跳回登入頁），
> 到 **Variables** 確認 `${{RAILWAY_PUBLIC_DOMAIN}}` 有被代換成實際網址；
> 沒有的話就手動把那三行改成實際網址：
> `N8N_HOST` **不含** `https://`，另外兩個**要含** `https://` 且**結尾有斜線**。

### 這幾個變數為什麼重要

| 變數 | 作用 |
|---|---|
| `NODE_FUNCTION_ALLOW_BUILTIN=crypto` | 讓「驗證簽章」節點能做 HMAC-SHA256。**沒設的話簽章驗證會直接失敗** |
| `N8N_BLOCK_ENV_ACCESS_IN_NODE=false` | 讓工作流讀得到 `LINE_CHANNEL_SECRET`，密鑰因此不必寫進工作流 |
| `N8N_DEFAULT_BINARY_DATA_MODE=filesystem` | LINE 影片可能很大，走磁碟而非記憶體 |
| `EXECUTIONS_DATA_MAX_AGE=336` | 執行紀錄只留 14 天，避免資料庫（與帳單）無限長大 |

貼完按 **Save / Update Variables**。

> **建議把第 4、6、7 節都做完再按一次 `Deploy`**，一次套用所有變更。
> 分次部署不會壞掉，只是會多幾輪重啟。

---

## 7. 加一個 Volume

n8n 有些檔案要放在磁碟上（暫存的附件、內部設定）。沒有 Volume 的話每次重啟都會清空。

1. n8n 服務 → **Settings → Volumes**（或右鍵服務 → `Attach Volume`）
2. **Mount path** 填：

   ```text
   /home/node/.n8n
   ```

3. 大小用預設即可

---

## 8. 確認跑起來了

1. 等部署完成（**Deployments** 分頁顯示綠色 / `Active`）
2. 開 `https://<你的網址>/`
3. 出現 n8n 的註冊畫面 → **成功** 🎉
   建立管理員帳號（信箱＋密碼，**存進密碼管理器**）

### 沒跑起來的話

看 n8n 服務的 **Deployments → View Logs**：

| 日誌訊息 | 原因 | 解法 |
|---|---|---|
| `ECONNREFUSED` / `getaddrinfo` 相關 | Postgres 變數對不上 | 確認資料庫服務名稱是 `Postgres`，且第 6 節那六行 `DB_*` 有正確貼上 |
| `no pg_hba.conf entry` / 出現 `SSL` 字樣 | 資料庫要求 SSL 連線 | 在 Variables 補上這兩行後重新部署：<br>`DB_POSTGRESDB_SSL_ENABLED=true`<br>`DB_POSTGRESDB_SSL_REJECT_UNAUTHORIZED=false` |
| `Application failed to respond` | Railway 對到錯的 port | Settings → Networking，把 port 改成 `5678` |
| 一直重啟 | `N8N_ENCRYPTION_KEY` 沒填或格式怪 | 重新產生一組純英數字串再填 |
| 開得起來但畫面怪怪的、登入後跳回 | `WEBHOOK_URL` / `N8N_EDITOR_BASE_URL` 少了 `https://` 或結尾斜線 | 依第 6 節格式修正 |

---

## 9. 匯入工作流

1. 從 GitHub 下載這兩個檔案到你的電腦：
   - [`01-line-ingest.json`](../../n8n/workflows/01-line-ingest.json)
   - [`02-error-handler.json`](../../n8n/workflows/02-error-handler.json)

   （在 GitHub 頁面按 **Raw** → 右鍵另存新檔）

2. n8n 右上 `⋯` → **Import from File** → 逐一匯入

接著回到
[`第一步-LINE串接n8n-建置指南.md`](第一步-LINE串接n8n-建置指南.md) **第 6 節**繼續：
建立四組 Credential → 設定錯誤通知 → 啟用 → 切換 LINE Webhook。

### Dropbox 的 Redirect URI 要用新網址

建置指南第 6.4 節提到要在 Dropbox App 填 Redirect URI，
用 Railway 的話請填：

```text
https://<你的Railway網址>/rest/oauth2-credential/callback
```

### LINE Webhook URL 也是新網址

建置指南第 8 節要填進 LINE Console 的網址改成：

```text
https://<你的Railway網址>/webhook/line
```

---

## 10. 備份

Railway 的 PostgreSQL 有自動備份（在 Postgres 服務的 **Backups** 分頁可以看到與還原），
所以自架版的 `backup.sh` 不需要了。

但有一件事**你還是要自己做**：

> **把 `N8N_ENCRYPTION_KEY` 存進密碼管理器。**
> 資料庫備份裡的 Credential 是加密的，沒有這把金鑰還原回來也解不開。

建議把第 6 節整段環境變數都存一份到密碼管理器，日後搬家或重建時直接貼。

---

## 11. 日常維運

| 想做什麼 | 怎麼做 |
|---|---|
| 看 n8n 執行紀錄 | n8n 介面左側 **Executions** |
| 看服務日誌 | Railway → n8n 服務 → **Deployments → View Logs** |
| 重新啟動 | Railway → 服務右上 `⋮` → **Restart** |
| 升級 n8n | Railway → 服務 `⋮` → **Redeploy**（會重抓 `:latest`） |
| 改環境變數 | **Variables** 分頁改完存檔，會自動重新部署 |
| 看花了多少錢 | Railway → **Usage** |

> 升級前建議先看 n8n 的 release notes；`:latest` 偶爾會有破壞性變更。
> 想更保險可以把映像檔標籤從 `:latest` 改成特定版本號（例如 `:1.60.0`），
> 需要升級時再手動改號碼。

---

## 12. 之後想換成自己的網域

不急，但如果之後想用 `n8n.niddesignlab.com`：

1. Railway → n8n 服務 → **Settings → Networking → Custom Domain**
2. 填 `n8n.niddesignlab.com`，Railway 會給你一個 CNAME 目標
3. 到 [WordPress.com DNS](https://wordpress.com/domains/manage/niddesignlab.com/dns/niddesignlab.com)
   新增一筆 **CNAME**：名稱 `n8n`，內容填 Railway 給的目標
4. 回 Railway 等它驗證通過
5. 把環境變數的 `N8N_HOST` / `WEBHOOK_URL` / `N8N_EDITOR_BASE_URL` 改成新網域
6. **LINE Console 的 Webhook URL 也要同步改**，否則訊息會繼續打到舊網址

> 注意這裡用的是 **CNAME**（Railway 給的目標），跟自架 VPS 的 **A 記錄**（IP）不同。
