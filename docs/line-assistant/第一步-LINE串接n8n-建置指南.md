# 第一步｜LINE 官方帳號 × n8n × Dropbox × Notion 建置指南

文件版本：2026-08-22
適用對象：川果設計 NID DESIGN LAB
目標：把「川果設計小助理」放進各個 LINE 群組，自動分類並歸檔訊息與檔案

> **安全說明**：本文件不含任何 Channel Secret、Access Token、API Key 或密碼。
> 所有密鑰只存在於 VPS 上的 `.env` 與 n8n 的 Credential 中，不進版控、不貼進 LINE 群組。

---

## 1. 這一步要完成什麼

```text
LINE 群組（業主群／工程群／設計群…）
   │  訊息、照片、影片、報價單 PDF、DWG
   ▼
LINE Messaging API
   │  HTTPS Webhook + X-Line-Signature
   ▼
n8n（自架於你的 VPS）
   ├─ 驗證簽章 ─────────── 擋掉偽造請求
   ├─ 群組白名單 ────────── 只記錄核准過的群組
   ├─ 去重 ──────────────── 用 Message ID 擋掉 LINE 重送
   ├─ 文字 → Claude 分類 ── 工作／聯絡／行事曆／決策／報價／資訊
   └─ 附件 → 下載 → 上傳 ─┐
                          │
        ┌─────────────────┴─────────────────┐
        ▼                                   ▼
   Dropbox（檔案實體）              Notion（索引與分類）
   照片／影片／PDF／DWG            05｜檔案索引
                                   06｜訊息紀錄
                                   （關聯到既有的 01｜專案、02｜群組登錄）
```

完成後你會有：

- 一個自己的 n8n 服務，網址 `https://n8n.niddesignlab.com`
- 所有群組檔案自動落到 Dropbox，用「群組／年月」分好資料夾
- Notion 內可以用專案、群組、分類、時間篩選所有訊息與檔案
- 出錯時 LINE 會推播通知你

**這一步不做的事**：機器人不會在群組裡講話（背景記錄模式），也還不會產生週報。週報是第二步。

---

## 2. 重要決策說明

### 2.1 為什麼建議 Dropbox

你問的是要不要用 Dropbox 存檔案。**建議用，而且對設計公司來說理由很具體**：

| 需求 | Dropbox | Google Drive | Cloudflare R2（現行） |
|---|---|---|---|
| AutoCAD 直接開 DWG | ✅ 同步後就是本機路徑，可直接開、直接存 | ⚠️ Drive for Desktop 可以，但外部參照（xref）路徑較易斷 | ❌ 得先下載 |
| 大檔同步穩定度 | ✅ 業界最穩，區塊級差異同步 | 🟡 尚可 | ❌ 非同步服務 |
| 選擇性同步（省本機硬碟） | ✅ Smart Sync 成熟 | 🟡 有但較陽春 | ❌ |
| 同仁用檔案總管／Finder 找檔 | ✅ | ✅ | ❌ |
| 檔案版本還原 | ✅ 180 天 | ✅ 30 天 | ❌ 需自建 |
| 成本 | 較高 | 若已有 Workspace 則最低 | 極低 |

決定關鍵在**DWG 與外部參照**。設計公司的圖檔常互相參照，只有本機同步資料夾能讓 AutoCAD 正常解析路徑。R2 便宜但同仁無法用檔案總管操作，等於每次都要下載，實務上會被放棄使用。

**成本代價要先知道**：Dropbox Business Standard 約 US$15／人／月、最少 3 人，換算約 NT$1,300–1,500／月。若覺得偏高，替代方案是先用 Dropbox **個人 Plus 方案**（2TB，約 NT$330／月）跑第一步驗證，量起來再升級 Business。

詳細資料夾結構與保存政策見 `Dropbox-儲存方案與資料夾結構.md`。

### 2.2 為什麼 n8n 直接接管 Webhook（以及風險）

**LINE 一個 Channel 只能設定一個 Webhook URL。** 你選擇讓 n8n 接管，代表：

- Webhook 從 `https://line.niddesignlab.com/webhook/line` 改成 `https://n8n.niddesignlab.com/webhook/line`
- **既有的 Cloudflare 系統會立刻停止收到任何訊息**（程式還在，只是沒有流量）
- 舊系統 D1／R2 內的歷史資料不受影響，仍可查詢

**風險與對策**：切換當下若 n8n 有問題，訊息會漏接且無法補回。因此請照第 8 節的順序做——**先把 n8n 全部測通，最後一步才改 Webhook**。萬一出狀況，把 LINE Console 的 Webhook URL 改回舊網址即可在一分鐘內回退。

### 2.3 為什麼分類用 Claude 而不是原本的 OpenAI

沒有非換不可的理由，兩者都能做。這裡預設用 `claude-opus-5` 是因為它的繁體中文與相對日期推理（「這週五」「下週三」）較穩，且支援 JSON Schema 結構化輸出，回傳格式不會跑掉。

**要換回 OpenAI 或改用便宜模型都很容易**：只改「組出 AI 分類請求」這一個節點，第 10 節有說明。

---

## 3. 事前準備清單

開始之前先備齊：

| 項目 | 說明 | 取得方式 |
|---|---|---|
| VPS | Ubuntu 22.04／24.04，2 vCPU／4GB RAM／60GB SSD 起 | Hetzner、Vultr、Linode、DigitalOcean 皆可 |
| 網域子網域 | `n8n.niddesignlab.com` 的 DNS 管理權 | 你目前管理 niddesignlab.com 的地方 |
| LINE Channel | Channel ID `2010874992`（已有） | LINE Developers Console |
| Dropbox 帳號 | Business 或 Plus | dropbox.com |
| Notion | 已完成（資料庫已建好） | 見第 6 節 |
| Anthropic API Key | 需綁信用卡並儲值 | console.anthropic.com |

> VPS 建議選機房在**日本、新加坡或台灣**，離 LINE 的伺服器近，Webhook 回應較快。

---

## 4. 步驟一：把 n8n 跑起來

**有兩條路可以選，擇一即可。功能完全相同，工作流 JSON 也一樣。**

| | A. 代管 n8n（Railway） | B. 自架 VPS |
|---|---|---|
| 你要做的事 | 網頁上點一點、填環境變數 | 開 VPS、SSH、Docker、設 DNS |
| 時間 | 20–30 分鐘 | 40–60 分鐘 |
| 月費（約） | NT$160–500 | NT$700 |
| HTTPS 憑證 | 自動 | Caddy 自動（需先設好 DNS） |
| 需要加 DNS 記錄嗎 | **不用**（用它給的網址） | 要 |
| 備份 | 平台自動 | 自己跑 `backup.sh` |
| 網址 | `xxx.up.railway.app` | `n8n.niddesignlab.com` |

**沒有伺服器管理經驗的話選 A。** 兩者都不影響後續步驟，
只有「Webhook URL」與「Dropbox Redirect URI」要換成對應的網址。

- **A（建議）** → [`代管n8n部署-Railway.md`](代管n8n部署-Railway.md)，做完接回本文件第 6 節
- **B** → [`VPS開通與DNS設定-逐步操作.md`](VPS開通與DNS設定-逐步操作.md)，或照下面 4.1–4.3 的摘要

以下 4.1–4.3 是 **B（自架 VPS）** 的摘要。選 A 的話請直接跳到第 6 節。

### 4.1 設定 DNS

到管理 `niddesignlab.com` 的地方新增一筆 A 記錄：

| 類型 | 名稱 | 值 | TTL |
|---|---|---|---|
| A | `n8n` | 你的 VPS 對外 IP | 自動／300 |

`niddesignlab.com` 的 DNS 由 **WordPress.com** 管理（NS 為 `ns1/ns2/ns3.wordpress.com`）：
<https://wordpress.com/domains/manage/niddesignlab.com/dns/niddesignlab.com>

- 按右上 **新增記錄** → TYPE 選 **A**（不是 CNAME）、名稱填 `n8n`、內容填 VPS IP
- 現有的 `line` 是 **CNAME** 指向 `custom-domains.chatgpt.site`（舊系統託管在 OpenAI Sites），
  **不要照它的型別做**
- **不要動既有記錄**（`A @`、`CNAME www`、`CNAME line`、`MX @`、`wpcloud*._domainkey`），
  否則官網、舊系統或公司信箱 `info@niddesignlab.com` 會掛
- WordPress.com 的 TTL 固定 3600 秒，生效可能要等最多 1 小時

用這個指令確認生效：

```bash
dig +short n8n.niddesignlab.com     # Windows 用 nslookup n8n.niddesignlab.com
```

**查得到 IP 才往下做**，太早跑 `install.sh` 會拿不到憑證。

> 日後若把 NS 換到 Cloudflare，記得該筆記錄要設成灰色雲朵「DNS only」——
> 橘色雲朵（Proxied）會讓 Caddy 拿不到憑證，也會改寫請求內容導致 LINE 簽章驗證失敗。

### 4.2 安裝 n8n

SSH 進 VPS，然後：

```bash
# 取得本專案
sudo apt-get update && sudo apt-get install -y git
# 注意：-b 分支名稱不能省略，repo 的預設分支還沒有這些檔案
sudo git clone -b claude/line-assistant-n8n-integration-57c1w3 \
  https://github.com/nicko751031-a11y/NIDDESIGN.git /opt/niddesign
cd /opt/niddesign/infra/n8n

# 建立設定檔（腳本會自動產生加密金鑰與資料庫密碼）
sudo cp .env.example .env
sudo nano .env
```

`.env` 內**必填**這幾項：

```ini
N8N_HOST=n8n.niddesignlab.com
ACME_EMAIL=nicko751031@gmail.com
LINE_CHANNEL_SECRET=<從 LINE Console 複製，見 4.3>
```

`N8N_ENCRYPTION_KEY` 與 `POSTGRES_PASSWORD` 留空即可，安裝腳本會自動產生。

接著執行：

```bash
sudo bash install.sh
```

腳本會依序：安裝 Docker → 設定防火牆 → 產生密碼 → 檢查 DNS → 啟動服務。

完成後開 `https://n8n.niddesignlab.com/`，建立管理員帳號。

> 首次簽發憑證約需 10–30 秒。若顯示憑證錯誤，等一下重整；持續失敗就看 `sudo docker compose logs caddy`，通常是 DNS 還沒指過來。

### 4.3 先取得 LINE Channel Secret

到 [LINE Developers Console](https://developers.line.biz/console/channel/2010874992/basic-info)：

- **Basic settings** 頁 → `Channel secret` → 複製
- 貼進 `.env` 的 `LINE_CHANNEL_SECRET`
- 改完執行 `sudo docker compose up -d` 讓 n8n 重新載入

---

## 5. 步驟二：備份設定（先做，不要拖）

```bash
# 每天凌晨 3 點自動備份資料庫與 .env
sudo crontab -e
```

加入這一行：

```cron
0 3 * * * /opt/niddesign/infra/n8n/backup.sh >> /var/log/nid-n8n-backup.log 2>&1
```

**另外請把 `.env` 離線抄一份**（例如存進密碼管理器）。裡面的 `N8N_ENCRYPTION_KEY` 一旦遺失，n8n 資料庫裡所有已儲存的 Credential 都無法解密，只能全部重建。

---

## 6. 步驟三：建立四組 Credential

在 n8n 左側 **Credentials → Add credential** 逐一建立。名稱請照抄，匯入工作流後才會自動對上。

### 6.1 LINE Channel Access Token

先到 LINE Console 取得：

1. [Messaging API 設定頁](https://developers.line.biz/console/channel/2010874992/messaging-api)
2. 最下方 `Channel access token (long-lived)` → **Issue**（若已存在就直接複製）

在 n8n：

| 欄位 | 值 |
|---|---|
| 類型 | **Header Auth** |
| 名稱 | `LINE Channel Access Token` |
| Name | `Authorization` |
| Value | `Bearer <貼上剛剛的 token>` |

> `Bearer` 後面**要有一個空格**，這是最常見的設定錯誤。

### 6.2 Notion Integration Token

1. 開 [Notion Integrations](https://www.notion.so/profile/integrations) → **New integration**
2. 類型選 **Internal**，關聯到你的工作區，名稱填 `NID LINE 助理`
3. Capabilities 勾選 **Read content / Update content / Insert content**
4. 複製 `Internal Integration Secret`（`ntn_` 或 `secret_` 開頭）

**接著最關鍵的一步——把頁面分享給這個 Integration：**

1. 開 Notion 頁面 [🏗️ 川果設計｜LINE 助理系統](https://www.notion.so/3b272e8fda6181be90ccc6e16358e007)
2. 右上 `⋯` → **連線／Connections** → 選擇 `NID LINE 助理`
3. 底下的 6 個資料庫會自動繼承權限

> 漏掉這一步的話，n8n 會回 `404 object_not_found`，而不是權限錯誤，很容易誤判。

在 n8n：

| 欄位 | 值 |
|---|---|
| 類型 | **Header Auth** |
| 名稱 | `Notion Integration Token` |
| Name | `Authorization` |
| Value | `Bearer <貼上 Integration Secret>` |

### 6.3 Anthropic API Key

1. 開 [Anthropic Console](https://console.anthropic.com/settings/keys) → 建立 API Key
2. 到 Billing 儲值（建議先儲 US$20 試跑一個月）

在 n8n：

| 欄位 | 值 |
|---|---|
| 類型 | **Header Auth** |
| 名稱 | `Anthropic API Key` |
| Name | `x-api-key` |
| Value | `<貼上 API Key，前面不要加 Bearer>` |

> 注意 Anthropic 用的是 `x-api-key`，不是 `Authorization`，和前兩個不一樣。

### 6.4 Dropbox OAuth2

> **⚠️ 重要（2026-08-26 實戰教訓）**：n8n 內建的「Dropbox OAuth2 API」憑證類型**權限清單寫死且不含 `sharing.write`**，
> 會導致「建立分享連結」永遠回 `missing_scope`，且無論在 Dropbox App Console 開放什麼權限都無效。
> **正確做法**：改用通用的「**OAuth2 API**」憑證類型，自行填入：
> Authorization URL `https://www.dropbox.com/oauth2/authorize`、Access Token URL `https://api.dropboxapi.com/oauth2/token`、
> Scope `files.metadata.read files.metadata.write files.content.read files.content.write sharing.read sharing.write account_info.read`、
> Auth URI Query Parameters `token_access_type=offline`、Authentication `Header`。
> 工作流中的兩個 Dropbox 節點以 Generic Credential Type（OAuth2 API）掛載此憑證。

先建立 Dropbox App：

1. 開 [Dropbox App Console](https://www.dropbox.com/developers/apps) → **Create app**
2. 選 **Scoped access**
3. 存取範圍選 **Full Dropbox**
   （若想更保守可選 App folder，但要改一行程式，見第 12.3 節）
4. App name 填 `NIDDESIGN LINE Assistant`
5. 進入 App 後切到 **Permissions** 分頁，勾選這六項並按 **Submit**：
   - `files.metadata.read`
   - `files.metadata.write`
   - `files.content.read`
   - `files.content.write`
   - `sharing.read`
   - `sharing.write`
6. 回到 **Settings** 分頁，在 `Redirect URIs` 加入：
   ```text
   https://n8n.niddesignlab.com/rest/oauth2-credential/callback
   ```
   用 Railway 的話改成 `https://<你的Railway網址>/rest/oauth2-credential/callback`
7. 複製 `App key` 與 `App secret`

> **順序很重要**：一定要先在 Permissions 按 Submit，再回 n8n 授權。順序反了會拿到權限不足的 token，上傳時報 `missing_scope`。

在 n8n：

| 欄位 | 值 |
|---|---|
| 類型 | **Dropbox OAuth2 API** |
| 名稱 | `Dropbox OAuth2` |
| Access Type | `Full Dropbox`（與步驟 3 一致） |
| Client ID | App key |
| Client Secret | App secret |

填完按 **Connect my account**，在彈出視窗登入並允許。

---

## 7. 步驟四：匯入並設定工作流

### 7.1 匯入

n8n 右上 `⋯` → **Import from File**，依序匯入：

- `n8n/workflows/01-line-ingest.json`
- `n8n/workflows/02-error-handler.json`

（檔案在 VPS 的 `/opt/niddesign/n8n/workflows/`，可以用 `scp` 抓到本機再上傳，或直接在本機從 GitHub 下載。）

### 7.2 對應 Credential

匯入後每個 HTTP Request 節點會顯示紅色驚嘆號。逐一點開，在 Credential 下拉選單選對應的那一組：

| 節點 | Credential |
|---|---|
| `Notion｜查詢群組白名單`、`Notion｜檢查重複訊息`、`Notion｜登錄待確認群組`、`Notion｜寫入訊息紀錄`、`Notion｜寫入檔案索引`、`Notion｜寫入附件訊息紀錄` | Notion Integration Token |
| `LINE｜取得群組名稱`、`LINE｜取得發送者名稱`、`LINE｜下載檔案內容` | LINE Channel Access Token |
| `AI 分類（Claude）` | Anthropic API Key |
| `Dropbox｜上傳檔案`、`Dropbox｜建立分享連結` | Dropbox OAuth2 |

### 7.3 設定錯誤通知

1. 開「01｜LINE 群組訊息接收與歸檔」→ 右上 `⋯` → **Settings**
2. `Error Workflow` 選「02｜錯誤通知」→ Save
3. 在 `.env` 填 `N8N_ALERT_LINE_TARGET`（你的 LINE User ID）
   （第一次跑完之後，從執行紀錄的「展開訊息事件」節點就能看到自己的 `userId`）
4. `sudo docker compose up -d`

### 7.4 啟用

把「01｜LINE 群組訊息接收與歸檔」右上角的開關切到 **Active**。

啟用後，在 `Webhook｜LINE 接收` 節點點開，複製 **Production URL**，應該是：

```text
https://n8n.niddesignlab.com/webhook/line
```

---

## 8. 步驟五：切換 LINE Webhook（最後才做）

> 這一步之後，舊的 Cloudflare 系統就收不到訊息了。前面全部確認無誤再執行。

### 8.1 Messaging API 設定

到 [Messaging API 設定頁](https://developers.line.biz/console/channel/2010874992/messaging-api)：

| 設定 | 值 |
|---|---|
| Webhook URL | `https://n8n.niddesignlab.com/webhook/line`<br>（用 Railway 的話填 `https://<你的Railway網址>/webhook/line`） |
| Use webhook | **開啟** |
| Webhook redelivery | **開啟** |
| Error statistics aggregation | 開啟 |
| Allow bot to join group chats | **開啟** |
| Auto-reply messages | 停用 |
| Greeting messages | 停用 |

填完按 **Verify**。應該回 `Success`。

> Verify 送的是空的 `events: []`，工作流會回 200 但不做任何事，這是正常的。
>
> **若 Verify 回「A timeout occurred」**：Webhook 節點的 Respond 必須是 **Immediately**（收到就回 200，處理在背景進行）。若設成「Using Respond to Webhook node」，回應會等簽章驗證的 Code 節點跑完才送出，在 Railway 的小容器上常超過 Verify 的時限。工作流 JSON 已採用 Immediately 模式；就算 Verify 偶爾逾時，實際訊息推送仍會正常送達（Use webhook 開著即可），且 redelivery 會補送。

### 8.2 LINE Official Account Manager

自動回覆有兩個地方要關，只關 Developers Console 不夠：

1. 開 [LINE Official Account Manager](https://manager.line.biz/)
2. 選「川果設計 NID DESIGN LAB」
3. **設定 → 回應設定**：
   - 聊天：開啟
   - 自動回應訊息：**關閉**
   - 加入好友的歡迎訊息：**關閉**

---

## 9. 步驟六：登錄群組並測試

### 9.1 白名單機制怎麼運作

系統**只記錄 Notion「02｜群組登錄」中狀態為「已登錄」的群組**。這是刻意的設計，避免官方帳號被拉進非公司群組後也把內容存下來。

流程是：

1. 把「川果設計 NID DESIGN LAB」(`@549mpmon`) 邀請進群組
2. 群組裡隨便發一則訊息
3. n8n 發現這個群組沒登錄 → 自動在「02｜群組登錄」開一列，狀態「待確認」
4. **你去 Notion 把該列補完並改成「已登錄」**：
   - 群組類型（業主群／工程群／設計群…）
   - 所屬專案（關聯到 01｜專案）
   - 排序權重（給第二步的週報用）
   - 摘要重點指示（選填，會餵給 AI，例如「此群重點在進場排程與缺失改善」）
5. 之後這個群組的訊息才會開始被記錄

> 步驟 3 之前的訊息**不會**被記錄，這是預期行為。核准後請重發一次測試訊息。

### 9.2 測試腳本

**建議先開一個全新的測試群組**，不要直接拿正在跑的專案群測。

| # | 動作 | 預期結果 |
|---|---|---|
| 1 | 建立測試群組，邀請 `@549mpmon` | — |
| 2 | 發送 `TEST 20260822-001` | Notion「02｜群組登錄」出現「待確認」新列 |
| 3 | 在 Notion 把它改成「已登錄」，補上群組類型與所屬專案 | — |
| 4 | 發送 `TEST 20260822-002` | 「06｜訊息紀錄」出現一列，分類「一般資訊」 |
| 5 | 發送 `這週五上午10:30跟AMY討論文心南六路的設計案` | 分類「行事曆」，到期時間填入週五 10:30，負責人 AMY |
| 6 | 發送 `收到` | 有紀錄，但分類「一般資訊」、優先級「低」（沒送 AI，省錢） |
| 7 | 上傳一張照片 | Dropbox 出現檔案；「05｜檔案索引」類型「照片」；「06｜訊息紀錄」有對應列且互相關聯 |
| 8 | 上傳一份檔名含「報價」的 PDF | 「05｜檔案索引」用途分類「報價單」；「06｜訊息紀錄」分類「報價金額」 |
| 9 | 上傳一個 `.dwg` | 用途分類「設計圖」、檔案類型「CAD 圖檔」 |
| 10 | 再發一次步驟 5 的同一則訊息 | 應該只有一列（去重生效）；重發相同內容會有新的 Message ID，所以會是兩列，這是正常的——去重擋的是 LINE 重送同一則 |

每一步都可以在 n8n 左側 **Executions** 看到完整的執行過程與每個節點的資料。

---

## 10. 費用估算

以下是估算，實際依用量而定。匯率以 1 USD ≈ NT$32 計。

| 項目 | 月費（約） | 備註 |
|---|---|---|
| VPS（2C／4G） | NT$150–800 | Hetzner 最便宜，DigitalOcean／Linode 較貴 |
| 網域 | 已有 | — |
| Dropbox Business Standard | NT$1,300–1,500 | 3 人起、5TB。個人 Plus 方案約 NT$330 |
| Notion | 已有 | — |
| Claude API | NT$500–900 | 見下方計算 |
| **合計** | **約 NT$2,000–3,200** | |

### Claude API 怎麼算

以每則需分類的訊息約 600 input tokens、200 output tokens 計，`claude-opus-5` 的價格是 input US$5／百萬、output US$25／百萬：

```text
每則 ≈ (600 × 5 + 200 × 25) ÷ 1,000,000 = US$0.008 ≈ NT$0.26
```

工作流內建的閒聊過濾（「收到」「好」「👍」等直接跳過 AI）大約能濾掉 **6–7 成**訊息。若全公司群組每天 300 則，實際送 AI 約 90–100 則：

```text
100 則 × NT$0.26 × 30 天 ≈ NT$780／月
```

**想降低成本**，改「組出 AI 分類請求」節點裡的一行即可：

| 模型 | 每則成本 | 每月（同上假設） | 適用 |
|---|---|---|---|
| `claude-opus-5`（預設） | NT$0.26 | ~NT$780 | 分類最準，中文與日期推理最穩 |
| `claude-sonnet-5` | NT$0.16 | ~NT$480 | 折衷 |
| `claude-haiku-4-5` | NT$0.05 | ~NT$150 | 最省，簡單訊息夠用、複雜語意會漏 |

建議先用 `claude-opus-5` 跑一個月，累積實際資料後看「AI 信心值」欄位的分布再決定要不要降級。

---

## 11. 故障排查

### 群組發訊息，Notion 沒東西

依序檢查：

1. **LINE 官方服務是否正常**：<https://api.line-status.info/>
2. **n8n 有沒有收到請求**
   ```bash
   sudo docker compose -f /opt/niddesign/infra/n8n/docker-compose.yml logs --tail=100 caddy | grep webhook
   ```
   看得到 `POST /webhook/line` 才代表 LINE 有送進來。
3. **n8n 的 Executions 有沒有紀錄**，有的話點進去看哪個節點紅了。
4. **群組是不是「已登錄」**——這是最常見的原因。到「02｜群組登錄」確認狀態。
5. 工作流是不是 **Active**。

### 執行到「IF｜簽章有效」就走 false

- `.env` 的 `LINE_CHANNEL_SECRET` 與 LINE Console 的 Channel secret 不一致
- 改完 `.env` 後忘了 `docker compose up -d`
- Cloudflare Proxy 開著改寫了請求內容 → 把該筆 DNS 記錄改成 DNS only

### Notion 節點回 404 `object_not_found`

Integration 沒有被加入頁面。回到 6.2 的分享步驟，確認「川果設計｜LINE 助理系統」頁面的 Connections 有 `NID LINE 助理`。

### Notion 節點回 400 `validation_error`

多半是 select 選項名稱對不上。例如程式送了「CAD 圖檔」但資料庫欄位裡沒有這個選項。到 Notion 對應欄位確認選項名稱**完全一致**（含空格與全形半形）。

### Dropbox 回 `missing_scope`

Permissions 改完沒按 Submit，或改完之後沒有重新授權。到 Dropbox App Console 確認權限已 Submit，再回 n8n 的 Dropbox Credential 按一次 **Connect my account** 重新授權。

### Dropbox 回 `Invalid character in header content`

中文檔名沒被正確轉成 ASCII。這代表「組出 Dropbox 路徑」節點的 `asciiEscape` 被改壞了，請從 Git 還原該節點程式。

### 大影片上傳失敗

單次上傳 API 上限 150MB。超過的檔案會在「05｜檔案索引」標成「上傳失敗」，Notion 仍有紀錄可以人工補檔。要支援更大的檔案需改用 Dropbox 的 upload session（分段上傳），屬於後續優化。

### AI 分類都是「一般資訊」且狀態「待處理」

代表 Claude API 呼叫失敗但工作流有續行（這是刻意設計，不讓訊息掉）。到 Executions 點開「AI 分類（Claude）」節點看錯誤：

- `401` → API Key 錯，或誤加了 `Bearer`
- `400 credit balance is too low` → Anthropic 帳戶要儲值
- `429` → 觸發速率限制，稍後會自動重試

---

## 12. 常見調整

### 12.1 換 AI 模型

「組出 AI 分類請求」節點，找到：

```js
model: 'claude-opus-5',
```

改成 `'claude-haiku-4-5'` 或 `'claude-sonnet-5'` 即可。

### 12.2 調整閒聊過濾

「展開訊息事件」節點的 `TRIVIAL` 集合與 `needsAi()`。想讓更多訊息送 AI 就縮小 `TRIVIAL`；想更省錢就把 `stripped.length < 3` 的門檻調高。

### 12.3 改用 Dropbox App folder 模式

若 Dropbox App 建立時選的是 App folder 而非 Full Dropbox，「組出 Dropbox 路徑」節點要改：

```js
const ROOT = '/NIDDESIGN-LINE助理';   // 改成 ↓
const ROOT = '';
```

檔案會落在 `Dropbox/應用程式/NIDDESIGN LINE Assistant/` 底下。

### 12.4 改資料夾結構

同一個節點的這一行：

```js
const dropboxPath = `${ROOT}/${groupFolder}/${yearMonth}/${fileName}`;
```

例如想改成「專案 → 群組 → 年月」，把 `d.projectIds` 換成專案代號帶進來即可（需要在「整理訊息基本欄位」補上專案代號欄位）。

### 12.5 支援更多檔案類型

「組出 Dropbox 路徑」節點的 `TYPE_MAP` 與 `usage` 判斷。改完記得同步到 Notion「05｜檔案索引」的 select 選項，兩邊名稱必須一致。

---

## 13. 已知限制

| # | 限制 | 影響 | 現況 |
|---|---|---|---|
| 1 | LINE「照片」會被壓縮 | 傳照片會失真、失去 EXIF | 需保留原檔時請用「檔案」方式傳送。已寫在便利貼提醒 |
| 2 | 單檔上傳上限 150MB | 大影片會失敗 | 標成「上傳失敗」，可人工補。後續可改分段上傳 |
| 3 | LINE 檔案有下載期限 | Webhook 若漏接，附件可能永久遺失 | 已開啟 redelivery，並有錯誤通知 |
| 4 | 一個群組只能有一個 Messaging API Bot | 無法與其他 LINE 機器人並存於同群 | LINE 平台限制 |
| 5 | 成員未同意提供個資時取不到顯示名稱 | 會顯示 User ID 前 8 碼 | LINE 平台限制 |
| 6 | 附件的去重只擋到 06 那一層 | 極端情況下（05 寫入成功但 06 失敗後重送）可能有重複的檔案索引列 | 機率低，可人工刪除 |
| 7 | 多人聊天室（room）取不到群組名稱 | 資料夾會用 Group ID 命名 | LINE 沒有對應 API |
| 8 | 未登錄群組每次發言都會新增一列「待確認」 | 同一群可能有多列 | 核准後就不再新增；重複的列可直接刪 |

---

## 14. 個資與保留政策（請務必處理）

系統會長期保存同仁與業主的發言、顯示名稱與檔案。建議在正式上線前：

1. **在每個要納入的群組公告一次**，例如：
   > 本群組已加入「川果設計小助理」，會自動記錄訊息與檔案以利專案管理與週報彙整。若有不宜記錄的內容請避免在此群發送。

2. **訂定保留期限**，例如訊息紀錄保留 2 年、檔案永久保留。
3. **建立刪除流程**：Notion 刪除該列＋Dropbox 刪除檔案。
4. 業主群（02｜群組登錄 的「敏感度」欄位標為「含業主」）建議另外評估是否納入。

---

## 15. 完成後的下一步

第一步完成後，第二步可以接：

- **每週自動週報**：把「06｜訊息紀錄」依專案彙整成「03｜週報」（既有資料庫已備好）
- **待辦追蹤**：分類為「工作事項」的訊息自動開「04｜待辦事項」
- **行事曆輸出**：分類為「行事曆」的項目產生可訂閱的 iCalendar
- **群組內查詢**：讓小助理支援 `@小助理 查 文心南六路 的報價單` 這類指令

---

## 附錄：資源速查

| 項目 | 位置 |
|---|---|
| n8n 管理介面 | `https://n8n.niddesignlab.com/` |
| LINE Webhook URL | `https://n8n.niddesignlab.com/webhook/line` |
| LINE Developers Console | <https://developers.line.biz/console/channel/2010874992/messaging-api> |
| LINE 官方帳號管理 | <https://manager.line.biz/> |
| LINE 服務狀態 | <https://api.line-status.info/> |
| Notion 系統首頁 | [🏗️ 川果設計｜LINE 助理系統](https://www.notion.so/3b272e8fda6181be90ccc6e16358e007) |
| Dropbox App Console | <https://www.dropbox.com/developers/apps> |
| Anthropic Console | <https://console.anthropic.com/> |
| VPS 專案路徑 | `/opt/niddesign/infra/n8n/` |

### Notion 資料庫 ID

| 資料庫 | ID |
|---|---|
| 01｜專案 | `96295a88-0745-42be-a5db-b8cd0673ccd9` |
| 02｜群組登錄 | `e8151c00-4fdb-4496-8b04-5b91b6cc018d` |
| 03｜週報 | `47d6b48d-8f7c-4685-bde5-c1b1519a1313` |
| 04｜待辦事項 | `be48ac7f-19e8-4ecf-8067-71e036c76e87` |
| 05｜檔案索引 | `32903708-fccf-48a0-b219-767da737f0ea` |
| 06｜訊息紀錄 | `687c5006-5421-4692-a9d9-5ff390a9c55a` |

### 常用維運指令

```bash
cd /opt/niddesign/infra/n8n

sudo docker compose ps                    # 服務狀態
sudo docker compose logs -f n8n           # 即時日誌
sudo docker compose restart n8n           # 重啟
sudo docker compose pull && sudo docker compose up -d   # 升級 n8n
sudo bash backup.sh                       # 手動備份
```
