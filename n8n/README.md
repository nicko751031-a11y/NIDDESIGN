# n8n Workflow 匯入說明

n8n 實例：`https://niddesignlab.app.n8n.cloud`

---

## 一、先建立 4 組憑證（Credentials）

n8n 左側 → `Credentials` → `Add credential` → 搜尋 **Header Auth**，建立四個：

| 憑證名稱 | Name | Value |
|---|---|---|
| `Worker Admin` | `Authorization` | `Bearer <ADMIN_TOKEN>` |
| `Notion` | `Authorization` | `Bearer <Notion Integration Token>` |
| `OpenAI` | `Authorization` | `Bearer <OPENAI_API_KEY>` |
| `Slack Bot` | `Authorization` | `Bearer xoxb-...` |

> `Bearer` 後面要有一個空格。這是最常見的錯誤來源。

---

## 二、匯入 Workflow

n8n 右上 `⋯` → `Import from File`，依序匯入：

1. `00-連線測試.json`
2. `01-週報產生-v0.json`

匯入後每個 HTTP 節點都要**手動指定憑證**（n8n 不會跟著檔案帶憑證，這是正常的安全設計）。

---

## 三、先跑 `00-連線測試`

點 `Execute Workflow`，四項應該全部通過。常見失敗：

| 症狀 | 原因 | 處理 |
|---|---|---|
| Worker 回 `401` | ADMIN_TOKEN 錯或少了 `Bearer ` | 檢查憑證值 |
| Notion 回 `404 object_not_found` | Integration 沒被加入母頁面 | 到 Notion 母頁面 `⋯ → Connections` 加入 Integration |
| Notion 回 `401 unauthorized` | Token 錯 | 重新複製 Integration Token |
| OpenAI 回 `model_not_found` | 帳號沒有該型號權限 | 把 `gpt-5-mini` 換成你有的型號 |
| Slack 回 `invalid_auth` | Bot Token 錯或 App 沒安裝到 workspace | 重新安裝 App |
| Slack 回 `not_in_channel` | Bot 沒被邀請進該頻道 | 在頻道打 `/invite @你的Bot` |

**四項全過才進下一步。** 不要跳過這步直接跑週報，錯誤會混在一起很難查。

---

## 四、跑 `01-週報產生-v0`

### 執行前提

- Notion `01｜專案` 至少一筆，且勾選「納入週報」、填好「專案代號」
- Notion `02｜群組登錄` 至少一筆，「註冊狀態」= 已登錄，並關聯到該專案
- 該群組的「群組 ID」必須是**真實的 LINE Group ID**（從 `https://line.niddesignlab.com/` 儀表板的最近訊息取得）

### 執行方式

用 **手動執行** 節點跑（`每週一 08:30` 排程節點預設是停用的）。

### ⚠️ 已知需要調整的地方

「抓 LINE 工作項目」節點呼叫 `GET /api/items`，但**這支 API 的實際回傳結構我沒有驗證過**。第一次執行後：

1. 點開該節點的輸出，看實際 JSON 長什麼樣
2. 對照「組裝專案資料」Code 節點裡的欄位對應：

```js
// 目前的容錯假設
const 全部項目 = Array.isArray(raw) ? raw
  : Array.isArray(raw.items) ? raw.items
  : Array.isArray(raw.results) ? raw.results
  : Array.isArray(raw.data) ? raw.data : [];

// 時間欄位
it.created_at || it.sent_at || it.createdAt || it.due_at

// 群組比對
it.group_id || it.groupId
```

3. 如果實際欄位名稱不在上面，把正確的加進去

若 `/api/items` 不支援時間範圍查詢，目前的做法是**全部拉回來再於 n8n 內過濾**。資料量大時會變慢，這是 v0 的已知取捨——正式版應該改用 `/api/export?from=&to=`（見架構文件 §4 步驟 2）。

### 節點流程

```
手動執行 / 每週一08:30
   → 計算週期            算出上週一~上週日、ISO 週次
   → 查專案              Notion，取「納入週報」的專案
   → 查群組登錄          Notion，取「已登錄」的群組
   → 抓 LINE 工作項目     Worker API
   → 組裝專案資料        依專案分組、依權重排序、產生 prompt
   → 產生摘要            OpenAI（失敗自動重試 3 次）
   → 組出版型            解析 JSON、產生 Slack 與 Notion 版型
   → 寫入 Notion 週報     狀態=草稿
   → 發布到 Slack        【預設停用】
```

### P0 影子模式

「發布到 Slack」節點**預設是停用的**，這就是架構文件講的影子模式：先只寫 Notion 草稿，你核對兩週、確認摘要沒在騙人之後，再啟用發布。

---

## 五、還沒做的部分

| 項目 | 狀態 | 卡在哪 |
|---|---|---|
| 群組自助註冊（`@小助理 這是…群`） | ❌ 未實作 | 需要修改 Cloudflare Worker 加上指令解析與 n8n 轉發，Worker 程式碼不在這個 repo |
| Slack 內部討論納入週報 | ❌ 未實作 | 需要 Slack Channel ID 與 `conversations.history` 權限 |
| 待辦事項跨週追蹤（DB-4） | ❌ 未實作 | 需要先有幾週的週報資料才有東西可比對 |
| `/api/export` 原始訊息匯出 | ❌ 未實作 | 需要修改 Worker |
| 唯讀 `EXPORT_TOKEN` | ❌ 未實作 | 需要修改 Worker（目前 n8n 拿的是最高權限的 ADMIN_TOKEN） |

**目前 v0 的摘要品質上限**：因為只吃 `/api/items`（已被 OpenAI 分類過的工作項目），而不是原始對話，摘要會比較「乾」，抓不到語氣與脈絡。這是刻意的取捨——先讓整條管線在零 Worker 改動的前提下跑通，再回頭升級資料源。
