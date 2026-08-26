# 讓 Codex 連到 LINE 官方帳號

先講三件會決定做法的事實，再講怎麼設定。

---

## 一、LINE 沒有「讀取歷史訊息」的 API

這是最常見的誤解。LINE Messaging API **只能被動接收**：訊息發生的當下，
LINE 把事件推到你設定的 webhook，過了就沒了，事後無法回頭查詢。

所以 Codex 想「看群組講了什麼」，**不是去問 LINE，而是去查 Notion**——
訊息早就被小助理歸檔進「06｜訊息紀錄」了，那才是可查詢的資料庫。

| Codex 想做的事 | 正確做法 |
|---|---|
| 看某群組最近在聊什麼 | 查 Notion 06｜訊息紀錄 |
| 找某個檔案 | 查 Notion 05｜檔案索引，或直接翻 Dropbox |
| 統計、分析、產週報 | 讀 Notion，不碰 LINE |
| 主動發訊息給群組或個人 | LINE Messaging API（見下方） |
| 取得群組名稱、成員暱稱 | LINE Messaging API |
| 下載某則訊息的附件 | LINE Messaging API（需要 messageId，從 Notion 06 拿） |

---

## 二、webhook 只能有一個，不要讓 Codex 搶走

LINE 一個 channel 只能設定**一組** webhook URL，目前指向 n8n：

```
https://n8n-production-65dca.up.railway.app/webhook/line
```

如果為了讓 Codex「即時收訊息」而把這個網址改掉，**整套歸檔會立刻停擺**——
Notion 不再進資料、Dropbox 不再備份、行事曆不再建事件。

要讓 Codex 也收到即時訊息，正確做法是在 n8n 工作流裡多接一個 HTTP Request
節點轉發出去，而不是動 webhook 設定。但除非你真的需要即時反應，
否則讓 Codex 讀 Notion 就夠了，也更省事。

---

## 三、Access Token 能以公司名義發訊息給業主

Channel Access Token 一旦交出去，持有者就能用「川果設計小助理」的身分
推播訊息到任何加過好友的人與群組——包含業主群。訊息送出後無法收回。

所以這個 token 的風險等級跟 n8n API key 不同，要分開考慮。

---

## 設定步驟

### ① 取得 Channel Access Token

到 [Messaging API 設定頁](https://developers.line.biz/console/channel/2010874992/messaging-api)
最下方「Channel access token (long-lived)」，複製既有的或按 Issue 產生。

> 注意：按 **Reissue** 會讓舊 token 失效，**n8n 會跟著壞掉**。
> 建議直接複製現有的那把，不要重新產生。

### ② 加進 Codex 的 Environment → Secrets

| 名稱 | 值 | 用途 |
|---|---|---|
| `LINE_CHANNEL_ACCESS_TOKEN` | 上面那串 | 呼叫 LINE API |
| `NOTION_TOKEN` | Notion Integration Token | 讓 Codex 能查訊息紀錄（更常用） |

`NOTION_TOKEN` 其實比 LINE token 更重要——Codex 大部分「了解群組在聊什麼」
的需求都靠它。

### ③ 驗證

```bash
scripts/line webhook     # 應顯示目前的 n8n webhook URL
scripts/line quota       # 本月推播用量
```

---

## Codex 可以下的指令

讀取類（安全，可放手）：

```bash
scripts/line profile U6f5e0cb8801732f3351ae3a04badd26d   # 使用者資料
scripts/line group C95b2f70911537846b75107fb0a67df0a     # 群組摘要
scripts/line member <groupId> <userId>                   # 群組成員資料
scripts/line content <messageId> out.jpg                 # 下載附件
scripts/line quota                                       # 推播用量
scripts/line webhook                                     # 確認 webhook 沒被改掉
```

送出類（預設只演練，不會真的送）：

```bash
scripts/line push <userId 或 groupId> "訊息內容"
```

`scripts/line` 對所有非 GET 操作預設**只印出要送什麼、不實際送出**。
確定要送才加環境變數：

```bash
LINE_ALLOW_SEND=1 scripts/line push U1234... "測試"
```

這道關卡是刻意設的：agent 判斷錯誤時，最糟情況是印出一段文字，
而不是把錯誤訊息推到業主手機上。建議**不要**把 `LINE_ALLOW_SEND=1`
設成 Codex 環境的預設值，讓每次送出都是明確的決定。

---

## 建議的分工

```
Codex 讀資料 ─→ Notion（訊息紀錄、檔案索引）  ← 主要來源
            └→ LINE API（群組名稱、成員、附件下載）  ← 補充

Codex 改流程 ─→ n8n API（scripts/n8n）

Codex 發訊息 ─→ 原則上不要。要發也經由 n8n 工作流，
                讓每則外發訊息都有紀錄可追。
```

最後這點值得展開：如果之後要做「小助理主動回報」的功能（例如每週推播週報到
管理群），建議做成 n8n 工作流，而不是讓 Codex 直接呼叫 LINE API。
理由是 n8n 有執行紀錄，出問題查得到是誰在什麼時候發了什麼；
agent 直接發則沒有這層軌跡。

---

## 相關資源

| 項目 | 位置 |
|---|---|
| LINE Developers Console | <https://developers.line.biz/console/channel/2010874992/messaging-api> |
| Channel ID | `2010874992` |
| 官方帳號 | 川果設計小助理 `@549mpmon` |
| 目前 webhook | `https://n8n-production-65dca.up.railway.app/webhook/line` |
| Notion 06｜訊息紀錄 | `687c5006-5421-4692-a9d9-5ff390a9c55a` |
| Notion 05｜檔案索引 | `32903708-fccf-48a0-b219-767da737f0ea` |
