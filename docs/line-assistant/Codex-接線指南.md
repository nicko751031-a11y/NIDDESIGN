# 讓 Codex 接上工作流

目標：Codex 能自己讀懂系統、連上 n8n、看執行紀錄、改工作流。
**你只需要做兩件事**（各約 30 秒），其餘都由 repo 內的腳本自動完成。

---

## 你要做的兩件事

### ① 讓 Codex 存取這個 repo

在 Codex 連接 GitHub 儲存庫 `nicko751031-a11y/NIDDESIGN`。

⚠️ **分支很重要**：所有內容在 `claude/line-assistant-n8n-integration-57c1w3`，
不是預設分支。若 Codex 的介面可以選分支就直接選它；不能選也沒關係，
下面的提示詞會叫它自己切換。

### ②-a 給它一把 n8n API key

1. 開 n8n → 右下角帳號 → **Settings** → **n8n API** → **Create an API key**
2. 複製產生的字串
3. 在 Codex 的 **Environment → Secrets** 新增：
   - 名稱：`N8N_API_KEY`
   - 值：剛才複製的字串

> 順便把舊的 key 撤銷。之前那把曾在對話中明文出現過，現在換掉最安全。

### ②-b（選用）讓它也能讀 Notion 與呼叫 LINE

Codex 大部分「了解群組在聊什麼」的需求靠 Notion 就能滿足，加這個最實用：

- `NOTION_TOKEN`：Notion Integration Token

若還需要取群組名稱、下載附件、或（謹慎地）推播訊息，再加：

- `LINE_CHANNEL_ACCESS_TOKEN`

⚠️ LINE 沒有讀取歷史訊息的 API，webhook 也只能有一個（現在指向 n8n，改掉會讓
歸檔停擺）。詳見 `docs/line-assistant/Codex-連接LINE.md`。

### ②-c（選用）讓它能查 Railway 日誌

只在需要診斷「n8n 整個沒回應」時才用得到：

- `RAILWAY_TOKEN`：**專案**權杖（Railway 專案 Settings → Tokens），不要用帳號權杖

詳見 `docs/line-assistant/Codex-連接Railway.md`。

---

## 然後把這段貼給 Codex

複製以下整段，貼進 Codex 對話框即可，它會自己完成剩下的接線與驗證：

```
請接手「川果設計小助理」這個 n8n 自動化專案。

第一步，切到正確分支並讀交接檔：
  git fetch origin claude/line-assistant-n8n-integration-57c1w3
  git checkout claude/line-assistant-n8n-integration-57c1w3
  cat AGENTS.md

第二步，執行自我檢查腳本確認你已接上線上工作流：
  scripts/codex-bootstrap

這支腳本會驗證分支、檔案、API key、n8n 連線，並把線上工作流快照
拉到 n8n/workflows/live/ 與 repo 版本比對。全部通過再往下做。

第三步，看一下目前狀況並回報你的理解：
  scripts/n8n get '/executions?workflowId=d5xNfn885DzBxrc3&limit=5'

請先只做讀取與理解，不要修改任何線上設定。看完後告訴我：
系統現在在做什麼、你觀察到哪些可以改善的地方。
```

---

## Codex 接上之後能做什麼

讀取類（可以放手讓它做）：

```bash
scripts/n8n get /workflows                                     # 列出所有工作流
scripts/n8n get /workflows/d5xNfn885DzBxrc3                    # 讀主工作流完整定義
scripts/n8n get '/executions?workflowId=d5xNfn885DzBxrc3&limit=10'   # 最近執行
scripts/n8n get '/executions/1234?includeData=true'            # 單次執行的節點輸入輸出
scripts/n8n get /workflows/d5xNfn885DzBxrc3/versions           # 版本歷史
```

修改類（建議先讓它說明要改什麼再放行）：

```bash
scripts/n8n put  /workflows/d5xNfn885DzBxrc3 @patched.json     # 更新草稿
scripts/n8n post /workflows/d5xNfn885DzBxrc3/publish           # 發布上線 ← 沒這步不會生效
```

`AGENTS.md` 裡已經寫清楚了：`PUT` 只吃 `name`/`nodes`/`connections`/`settings`
四個欄位，以及改完必須 publish。Codex 讀過就會照做。

---

## 為什麼要這樣設計

| 決定 | 原因 |
|---|---|
| API key 用環境變數，不寫進 repo | repo 有 PR、同事看得到；金鑰進 git 之後刪掉也會留在歷史裡 |
| 進入點取名 `AGENTS.md` | Codex 開專案時會自動讀這個檔名，等於它的開機說明書 |
| 附 `scripts/n8n` 包裝 | 省得每次拼 header，也避免它自己組錯 API 路徑 |
| 附 `scripts/codex-bootstrap` | 接線失敗時能明確指出是分支、金鑰還是網路的問題，不用你猜 |
| 快照存到 `n8n/workflows/live/` | 與 repo 版本分開放，比對後才知道兩邊是否同步 |

---

## 接不上時的判斷

`scripts/codex-bootstrap` 會直接告訴你卡在哪一關：

| 訊息 | 意思 | 處理 |
|---|---|---|
| ❌ AGENTS.md 不存在 | Codex 拿到的是預設分支 | 讓它執行上面提示詞的 `git checkout` |
| ❌ N8N_API_KEY 未設定 | Secrets 還沒加 | 回到步驟 ② |
| ❌ API key 被拒絕（401） | key 過期或已被輪換 | 到 n8n 重新產生一把 |
| ❌ 連不到 n8n 主機 | 網路或沙箱阻擋連外 | 在 Codex 環境允許連到 `n8n-production-65dca.up.railway.app` |
| ⚠️ 只在線上有／只在 repo 有 | 兩邊節點不同步 | 先決定以哪邊為準，別直接覆蓋 |

---

## 兩個 agent 一起工作時

Claude 與 Codex 可能同時改同一條工作流。避免互相覆蓋：

1. **改之前先拉線上快照**（`scripts/codex-bootstrap` 就會做），確認沒有別人剛改過
2. **一次一個人改**：要動工作流時先在對話裡講一聲
3. **改完立刻同步回 repo 並 commit**，讓另一邊看得到
4. n8n 有版本歷史（`/workflows/{id}/versions`），改壞了可以回溯
