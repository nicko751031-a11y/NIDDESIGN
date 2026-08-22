# n8n 工作流

匯入方式：n8n 右上 `⋯` → **Import from File**。

完整建置步驟見 [`docs/line-assistant/第一步-LINE串接n8n-建置指南.md`](../docs/line-assistant/第一步-LINE串接n8n-建置指南.md)。

## 工作流清單

| 檔案 | 名稱 | 用途 |
|---|---|---|
| `workflows/01-line-ingest.json` | 01｜LINE 群組訊息接收與歸檔 | 主流程：收訊、驗簽、白名單、去重、AI 分類、Dropbox 備份、Notion 寫入 |
| `workflows/02-error-handler.json` | 02｜錯誤通知 | 任一工作流失敗時，用 LINE 官方帳號推播給管理者 |

## 01 的資料流

```text
Webhook → 驗證簽章 → 回應 200 → 展開事件
                              ↓
                    查詢群組白名單 ──未登錄──→ 取得群組名稱 → 登錄「待確認」
                              ↓ 已登錄
                        檢查重複訊息 ──重複──→ 略過
                              ↓
                       取得發送者名稱 → 整理基本欄位
                              ↓
                     ┌────────┴────────┬──────────┐
                    文字              附件         其他
                     ↓                ↓            ↓
              需要 AI 分類?      下載檔案內容    套用預設分類
              ├─是→ Claude 分類   → Dropbox 上傳       ↓
              └─否→ 預設分類      → 建立分享連結  寫入 06｜訊息紀錄
                     ↓             → 寫入 05｜檔案索引
              寫入 06｜訊息紀錄    → 寫入 06｜訊息紀錄
```

## 需要的 Credential

| 名稱 | 類型 | Header |
|---|---|---|
| `LINE Channel Access Token` | Header Auth | `Authorization: Bearer <token>` |
| `Notion Integration Token` | Header Auth | `Authorization: Bearer <secret>` |
| `Anthropic API Key` | Header Auth | `x-api-key: <key>` |
| `Dropbox OAuth2` | Dropbox OAuth2 API | — |

## 需要的環境變數

由 `infra/n8n/.env` 提供，工作流用 `$env.XXX` 讀取：

| 變數 | 必要 | 用途 |
|---|---|---|
| `LINE_CHANNEL_SECRET` | 是 | 驗證 Webhook 簽章 |
| `N8N_ALERT_LINE_TARGET` | 否 | 錯誤通知推播對象 |
| `NOTION_DB_GROUPS` / `NOTION_DB_FILES` / `NOTION_DB_MESSAGES` | 否 | 覆寫 Notion 資料庫 ID，留空用內建預設 |

## 修改工作流的注意事項

- **JSON 內不含任何密鑰**，可以安全地提交進版控與分享。
- 節點名稱被程式碼用 `$('節點名稱')` 參照，**改名會讓下游節點壞掉**。
- Notion 的 select 欄位值必須與資料庫選項**完全一致**（含空格與全形半形），否則會回 400。
- 在 n8n 修改後，請用右上 `⋯` → Download 匯出，覆蓋回這裡的檔案並提交，避免版本漂移。
