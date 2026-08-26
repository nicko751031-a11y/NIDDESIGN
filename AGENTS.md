# AGENTS.md — 給 AI agent 的專案交接說明

這個 repo 管理「**川果設計小助理**」：一條把 LINE 對話與檔案自動歸檔到 Notion／Dropbox／Google 日曆的自動化流程。

任何 agent（Codex、Claude Code 或其他）在動手前請先讀完本檔。人類讀者請改看
`docs/line-assistant/川果設計小助理-使用說明.md`（操作面）與
`docs/line-assistant/第一步-LINE串接n8n-建置指南.md`（建置面）。

---

## 1. 系統長什麼樣

```
LINE 官方帳號（川果設計小助理 @549mpmon, Channel 2010874992）
      │  Webhook POST /webhook/line（附 X-Line-Signature）
      ▼
n8n（Railway 代管，Postgres 後端，新加坡區）
      │  工作流 01：驗簽 → 群組登錄 → 去重 → 分流
      ├─ 文字 → Claude Opus 分類 ─┬→ Notion 06｜訊息紀錄
      │                          └→ 有到期時間 → Google Calendar「川果設計」
      └─ 附件 → LINE 下載 ─┬─ 照片 → Claude Haiku 視覺分析
                          └→ Dropbox 上傳＋分享連結 → Notion 05｜檔案索引 → 06 補一筆
```

錯誤由工作流 02 透過 LINE 推播給管理者。

**重要前提**：n8n 是單執行緒主程序，LINE 的 Webhook 逾時約 2 秒。
Webhook 節點必須維持 `responseMode: onReceived`（先回 200 再處理），
且 Railway 必須保持 `N8N_RUNNERS_ENABLED=true`（Code 節點跑在獨立 runner，
否則會阻塞回應、觸發 LINE 每則訊息重送約 15 次）。**這兩項不要改。**

---

## 2. 連線方式

### 2-1 n8n 公開 API（主要控制面）

```bash
export N8N_API_KEY=...        # 見 .env.example；由 n8n UI → Settings → n8n API 產生
scripts/n8n get /workflows
scripts/n8n get /workflows/d5xNfn885DzBxrc3
scripts/n8n get '/executions?workflowId=d5xNfn885DzBxrc3&limit=5'
scripts/n8n get '/executions/1234?includeData=true'
```

- Base URL：`https://n8n-production-65dca.up.railway.app/api/v1`
- 認證：header `X-N8N-API-KEY`
- 更新工作流：`PUT /workflows/{id}`，body **只接受** `name` / `nodes` / `connections` / `settings`
  四個欄位，多送會被 400 拒絕。標準做法是 GET 回來 → 改 → 挑出這四個欄位 → PUT。
- n8n 2.x 有草稿／發布機制：PUT 只改草稿，**要 `POST /workflows/{id}/publish` 才會生效**。

### 2-2 n8n MCP server（Claude 端用）

Server URL：`https://n8n-production-65dca.up.railway.app/mcp-server/http`
每個工作流需在 UI 個別開啟「Available in MCP」開關才看得到。
Codex 若不支援 MCP，走 2-1 的 REST API 即可，功能等價。

### 2-3 沙箱連不出去時的後門

某些代理環境無法直連 `*.up.railway.app`。此時可建一個臨時 n8n 工作流，
用 HTTP Request 節點打 `http://localhost:5678/api/v1/...`（n8n 自己呼叫自己），
執行後讀 execution 結果。**用完務必刪除，且不要把 API key 寫進節點參數**
（會留在工作流 JSON 與執行紀錄裡）。

---

## 3. 資源清單

### 工作流

| ID | 名稱 | 說明 |
|---|---|---|
| `d5xNfn885DzBxrc3` | 01｜LINE 群組訊息接收與歸檔 | 主流程，40 節點，已啟用 |
| `S6BhMMX1APqqdJNl` | 02｜錯誤通知 | 設為 01 的 Error Workflow |

repo 內的 `n8n/workflows/*.json` 是**版本控管的鏡像**，不是執行來源。
線上改動後請同步回 repo；repo 改動後請同步上線。兩邊都要做。

### 憑證（n8n 內，只存 ID，值不外流）

| ID | 名稱 | 型別 | 用途 |
|---|---|---|---|
| `reHYOJ8P2hWkI5wa` | LINE Channel Access Token | httpHeaderAuth | 取群組／成員名稱、下載檔案 |
| `BXApPfyqkN0Cv8NX` | Notion Integration Token | httpHeaderAuth | 讀寫三個資料庫 |
| `Hp3H0dhRjdbKspCd` | Anthropic API Key | httpHeaderAuth | 文字分類＋影像分析 |
| `Skkg71dLFdwF05xt` | Dropbox OAuth2 v2 | oAuth2Api（通用） | 上傳＋建立分享連結 |
| `NRXkqStV4vW63OIS` | Google Calendar | googleCalendarOAuth2Api | 建立行事曆事件 |

⚠️ **Dropbox 必須用通用 OAuth2 憑證，不能用 n8n 內建的 Dropbox 節點憑證**：
內建型別把 scope 寫死成 `files.content.write files.content.read sharing.read account_info.read`，
缺 `sharing.write`，建立分享連結會回 `missing_scope`。通用憑證的 scope 要填：
`files.metadata.read files.metadata.write files.content.read files.content.write sharing.read sharing.write account_info.read`，
authQueryParameters 加 `token_access_type=offline`，Authentication 選 Header。

### Notion 資料庫

| 代號 | Database ID | 內容 |
|---|---|---|
| 02｜群組登錄 | `e8151c00-4fdb-4496-8b04-5b91b6cc018d` | 哪些聊天室要被記錄 |
| 05｜檔案索引 | `32903708-fccf-48a0-b219-767da737f0ea` | 備份檔案的索引與分享連結 |
| 06｜訊息紀錄 | `687c5006-5421-4692-a9d9-5ff390a9c55a` | 所有訊息、分類、到期時間 |

節點內以 `$env.NOTION_DB_GROUPS` 等環境變數讀取，並以上述 ID 作為 fallback。

### Google 行事曆

目標日曆：**川果設計** `sqvq9de1dn71h96t5738au8nag@group.calendar.google.com`
OAuth 用戶端建在 Google Cloud 專案 `gws-cli-493410`，
redirect URI 為 `https://n8n-production-65dca.up.railway.app/rest/oauth2-credential/callback`。

### Railway

Service 名稱 `n8n`，變數以 Railway MCP 或 Dashboard 管理。
`set-variables` 不會自動重新部署，改完要另外觸發 redeploy。

---

## 4. 工作流 01 的節點地圖

依資料流順序（貼紙節點略）：

```
Webhook｜LINE 接收 → 驗證簽章 → IF｜簽章有效 → 展開訊息事件
  → Notion｜查詢群組白名單 → IF｜群組已登錄
       ├─true→ Notion｜檢查重複訊息 → IF｜非重複訊息
       │           ├─true→ LINE｜取得發送者名稱 → 整理訊息基本欄位 → Switch｜訊息類型
       │           └─false→ 略過重複訊息
       └─false→ IF｜尚未建檔 → LINE｜取得群組名稱 → 組出待確認群組
                   → Notion｜登錄待確認群組 →（接回 Notion｜檢查重複訊息）

Switch｜訊息類型
  ├─文字→ IF｜需要 AI 分類 →（true）組出 AI 分類請求 → AI 分類（Claude） → 整理分類結果
  │                                                      ├→ Notion｜寫入訊息紀錄
  │                                                      └→ IF｜需建立行事曆 → Google Calendar｜建立事件
  │                        └（false）套用預設分類 → Notion｜寫入訊息紀錄
  ├─附件→ LINE｜下載檔案內容 → IF｜需要影像分析
  │          ├─true→ 組出影像分析請求 → AI｜影像分析（Claude） → 整理影像分析結果 ─┐
  │          └─false────────────────────────────────────────────────────────────┤
  │                                                                              ▼
  │        組出 Dropbox 路徑 → Dropbox｜上傳檔案 → Dropbox｜建立分享連結
  │            → 組出檔案索引 → Notion｜寫入檔案索引 → 組出附件訊息紀錄 → Notion｜寫入附件訊息紀錄
  └─其他→ 套用預設分類 → Notion｜寫入訊息紀錄
```

**要調整行為時該改哪個節點：**

| 想改什麼 | 改哪裡 |
|---|---|
| AI 分類邏輯、提示詞、換模型 | `組出 AI 分類請求` 的 jsCode |
| 影像分析的分類選項、提示詞 | `組出影像分析請求` 的 jsCode |
| 哪些訊息算閒聊、不送 AI | `展開訊息事件` 的 `TRIVIAL` 集合與 `needsAi()` |
| Dropbox 資料夾結構、檔名 | `組出 Dropbox 路徑` 的 jsCode |
| 檔案用途分類的關鍵字 | `組出 Dropbox 路徑` 的 `TYPE_MAP` 與 `has()` 判斷 |
| 寫進 Notion 的欄位 | `整理分類結果` / `套用預設分類` / `組出檔案索引` / `組出附件訊息紀錄` |
| 行事曆事件的標題／說明／時長 | `Google Calendar｜建立事件` 的參數 |
| 新群組是否自動核准 | `組出待確認群組` 的 `註冊狀態` 值 |

---

## 5. 現行規則（改動前請確認是否仍成立）

- **新群組自動核准**：偵測到未登錄的聊天室時，直接在 Notion 02 建立狀態為
  「已登錄」的列，並讓**同一則訊息**繼續走完流程（不漏第一則）。
  要停用某群組，把該列狀態改成「停用」。
- **去重**：以 LINE `messageId` 查 Notion 06，已存在就走 `略過重複訊息`。
- **一對一私訊**：`source.type === 'user'`，以對方 userId 當作聊天室鍵值，
  群組名稱顯示為「個人：某某」。
- **成本控制**：閒聊、貼圖、單字回覆不送 AI；影像限 4.5MB 以內才做視覺分析。
- **失敗不阻斷**：AI 節點、Dropbox 分享連結、行事曆節點都設
  `onError: continueRegularOutput`，單點失敗不影響歸檔主線。

---

## 6. 動手前的規矩

1. **改線上工作流前先 GET 一份下來留底**，或用 n8n 的版本歷史（`/workflows/{id}/versions`）。
2. **PUT 之後一定要 publish**，否則只改到草稿，線上跑的還是舊版。
3. **repo 與線上要同步**：改完線上請把 `n8n/workflows/01-line-ingest.json` 一併更新後 commit。
4. **不要把任何密鑰寫進 repo 或工作流 JSON**：包含 n8n API key、LINE token、
   Notion token、Anthropic key。一律用 `$env.XXX` 或 n8n 憑證。
5. **臨時工作流用完要刪**，特別是曾經內嵌 API key 的。
6. **測試建議自注入而非真的發 LINE 訊息**：建一個 Code 節點用
   `$env.LINE_CHANNEL_SECRET` 算 HMAC-SHA256 簽章，POST 到
   `http://localhost:5678/webhook/line`，body 造一則假事件。測完刪掉測試資料。
7. **Git 分支**：本專案在 `claude/line-assistant-n8n-integration-57c1w3`，
   PR #2 尚未合併，base 是 `claude/analysis-and-records-fm6p2x`。

---

## 7. 已知的坑（踩過了，別再踩一次）

| 症狀 | 真正原因 | 解法 |
|---|---|---|
| LINE 每則訊息重複執行 10+ 次 | Code 節點在主程序跑，回應超過 2 秒被 LINE 中斷後重送 | `N8N_RUNNERS_ENABLED=true` |
| LINE Console 按 Verify 逾時 | 同上；或 Webhook 不是 onReceived 模式 | 同上 |
| Dropbox 回 `missing_scope` | n8n 內建 Dropbox 憑證把 scope 寫死，沒有 `sharing.write` | 改用通用 OAuth2 憑證 |
| Dropbox 回 `invalid_client` | n8n 有時沒真的覆寫已存的 secret 欄位 | 刪掉重建憑證，完整重新輸入 |
| Dropbox 回 `Invalid character in header` | `Dropbox-API-Arg` 是 HTTP header，只能 ASCII | 中文檔名轉 `\uXXXX` 逸出（已在程式內處理） |
| Notion 回 400 validation_error | 欄位名稱或型別對不上 | 先 GET 該 database 的 schema 再組 payload |
| PUT 工作流回 400 | body 夾帶了 `id`／`active`／`tags` 等唯讀欄位 | 只送 name/nodes/connections/settings |
| MCP 回「Workflow is not available in MCP」 | 該工作流沒開 MCP 開關 | 到 n8n UI 開啟 |

---

## 8. 目前的待辦與方向

短期：
- 把「新群組自動核准」同步到線上（repo 已改，線上待套用）
- 清理臨時工作流 `ZZ5`／`ZZ6`
- 輪換 n8n API key（曾在對話中明文出現過）

規劃中的下一步：
- 每週自動週報：Notion 06 依專案彙整成 03｜週報
- 待辦追蹤：分類為「工作事項」的訊息自動開 04｜待辦事項
- 群組內查詢：支援 `@小助理 查 文心南六路 的報價單`

規劃新功能時請沿用既有慣例：新分支從既有節點拉出、失敗設
`continueRegularOutput`、寫 Notion 前先組 payload 的 Code 節點、
節點命名用「來源｜動作」格式（例如 `Notion｜寫入訊息紀錄`）。
