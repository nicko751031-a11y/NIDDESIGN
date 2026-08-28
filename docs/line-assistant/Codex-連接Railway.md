# 讓 Codex 連到 Railway

Railway 上跑的就是小助理本體（n8n）。給 Codex 這個權限的用途主要是
**看日誌、查部署狀態、診斷問題**，而不是日常操作。

---

## 先決定：要給哪一種權杖

Railway 有兩種權杖，差別很大：

| 種類 | 能碰到什麼 | 環境變數 | 建議 |
|---|---|---|---|
| **專案權杖 Project Token** | 只有指定的那個專案 | `RAILWAY_TOKEN` | ✅ 給 Codex 用這個 |
| 帳號權杖 Account Token | 你名下**所有**專案 | `RAILWAY_API_TOKEN` | ❌ 不要給 agent |

專案權杖的範圍剛好就是 n8n 那個專案，就算出問題也波及不到你其他東西。
帳號權杖等於整個 Railway 帳號的鑰匙，沒必要冒這個險。

### 取得專案權杖

1. 開 [Railway Dashboard](https://railway.com/dashboard)，進入 n8n 所在的專案
2. **Settings** → **Tokens**（專案層級，不是帳號層級）
3. 建立新權杖，環境選 **production**
4. 複製字串

### 加進 Codex 的 Environment → Secrets

| 名稱 | 值 |
|---|---|
| `RAILWAY_TOKEN` | 上一步的專案權杖 |

**不要**同時設 `RAILWAY_API_TOKEN`——Railway CLI 兩個都設會直接報錯。

---

## 驗證

```bash
scripts/railway whoami     # 應回傳 projectId 與 environmentId
scripts/railway services   # 列出專案內的服務
scripts/railway deploys    # 最近 5 次部署
```

---

## 可以下的指令

讀取類（安全）：

```bash
scripts/railway whoami                  # 權杖對應到哪個專案
scripts/railway services                # 服務清單
scripts/railway deploys                 # 最近部署與狀態
scripts/railway logs <deploymentId>     # 該次部署的日誌
scripts/railway gql '<query>'           # 任意 GraphQL 查詢
```

改變狀態類（預設只演練）：

```bash
scripts/railway redeploy <deploymentId>
RAILWAY_ALLOW_WRITE=1 scripts/railway redeploy <deploymentId>   # 真的執行
```

跟 `scripts/line` 同樣的設計：**所有會改變狀態的操作預設只印出要做什麼、
不實際執行**，包含任何 GraphQL mutation。要真的做才加 `RAILWAY_ALLOW_WRITE=1`。

理由比 LINE 那邊更硬：**這台服務就是小助理本體**。重啟或部署失敗期間 LINE
訊息收不到，而 LINE 不會無限重送，過期的訊息就永久遺失了。

---

## 三條紅線

### ① 不要動這兩個環境變數

| 變數 | 為什麼不能動 |
|---|---|
| `N8N_RUNNERS_ENABLED=true` | 關掉會讓 Code 節點回到主程序執行，回應超過 LINE 的 2 秒逾時，觸發每則訊息重送十幾次的災難（我們花了一整晚才找出這個原因） |
| `LINE_CHANNEL_SECRET` | 改掉簽章驗證會全部失敗，所有訊息被擋在門外 |

### ② 設定變數不會自動重新部署

Railway 的 `set-variables` 改完**不會自動生效**，要另外觸發 redeploy。
反過來說也代表：改了變數卻忘記部署，會出現「我明明改了怎麼沒用」的假象。

### ③ 這個專案沒有 staging

改動直接影響正式環境。要驗證行為，優先用 n8n 的手動執行或臨時工作流測試，
不要拿 Railway 部署當試驗場。

---

## 什麼時候才真的需要動 Railway

大部分情況不需要。判斷順序：

| 症狀 | 先看哪裡 |
|---|---|
| 訊息沒進 Notion | n8n 執行紀錄（`scripts/n8n get '/executions?...'`） |
| 某個節點報錯 | n8n 執行紀錄的節點輸入輸出 |
| 整個 n8n 打不開、API 沒回應 | ← **這時才看 Railway 日誌** |
| 訊息重送、回應變慢 | Railway 日誌找 body-stream-aborted，並確認 runners 有開 |
| 要調整資源、加環境變數 | Railway |

先查 n8n 再查 Railway，順序反過來會浪費很多時間。

---

## 相關資源

| 項目 | 位置 |
|---|---|
| Railway Dashboard | <https://railway.com/dashboard> |
| GraphQL API | `https://backboard.railway.com/graphql/v2` |
| 專案權杖 header | `Project-Access-Token: <token>` |
| 帳號權杖 header | `Authorization: Bearer <token>` |
| n8n 服務網址 | `https://n8n-production-65dca.up.railway.app` |
