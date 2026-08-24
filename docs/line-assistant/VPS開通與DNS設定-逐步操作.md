# VPS 開通與 DNS 設定｜逐步操作

文件版本：2026-08-22
對象：沒有伺服器管理經驗的人也能照做
預估時間：**40–60 分鐘**（其中等 DNS 生效可能要額外等 10 分鐘到 1 小時）
作業環境：Windows 10／11（Mac 的差異會另外註明）

這份文件只涵蓋「開機器 → 設網域 → 跑安裝」。
安裝完成之後的 Credential、LINE Console 設定，請接回
[`第一步-LINE串接n8n-建置指南.md`](第一步-LINE串接n8n-建置指南.md) 的第 6 節。

---

## 0. 開始前確認

| 需要的東西 | 說明 |
|---|---|
| 信用卡 | VPS 大多需要綁卡，首次可能要先儲值約 US$10 |
| `niddesignlab.com` 的 DNS 管理權 | 第 1 節教你怎麼確認在哪裡管理 |
| Windows 電腦 | Windows 10／11 內建 SSH，**不需要另外裝 PuTTY** |

> **費用提醒**：VPS 是**按時計費、開著就一直算錢**。測試完若不用，記得到後台 **Destroy（銷毀）**，只是關機（Stop）多數業者仍會收費。

---

## 1. DNS 管理位置（已確認）

2026-08-24 實測結果：

```powershell
PS> nslookup -type=NS niddesignlab.com

niddesignlab.com    nameserver = ns1.wordpress.com
niddesignlab.com    nameserver = ns2.wordpress.com
niddesignlab.com    nameserver = ns3.wordpress.com
```

**`niddesignlab.com` 的 DNS 由 WordPress.com 管理。** 第 3 節會在那裡加記錄。

> 這對我們是好事：WordPress.com 沒有 Cloudflare 那種「橘色雲朵 Proxy」機制，
> 不會改寫請求內容，所以憑證簽發與 LINE 簽章驗證都少一個坑。

> 日後若把 NS 換到別家（Cloudflare、GoDaddy…），重跑上面那行指令就知道新位置。

---

## 2. 開 VPS（約 15 分鐘）

### 2.1 選哪一家

| 業者 | 建議機房 | 規格 | 月費（約，請以官網為準） | 適合 |
|---|---|---|---|---|
| **Vultr** ← 建議 | 東京 Tokyo | 2 vCPU／4GB／80GB | US$20–24 | 介面單純、離 LINE 伺服器最近 |
| Hetzner | 新加坡 | 2 vCPU／4GB／40GB | €4–5（約 NT$170） | 最便宜，但介面英文、驗證較嚴 |
| DigitalOcean | 新加坡 | 2 vCPU／4GB／80GB | US$24 | 文件最豐富 |

**建議選 Vultr 東京**。理由是 LINE 的伺服器在日本，Webhook 來回延遲最低；而且 Vultr 按小時計費，萬一裝壞了砍掉重開只花幾塊錢。

以下用 Vultr 示範。其他家步驟大同小異：選 Ubuntu 24.04、2 vCPU／4GB、記下 IP。

### 2.2 先產生 SSH 金鑰（建議，比密碼安全很多）

在 PowerShell 執行：

```powershell
ssh-keygen -t ed25519 -C "niddesign-n8n"
```

- 問 `Enter file in which to save the key` → 直接按 **Enter**（用預設位置）
- 問 `Enter passphrase` → 可以直接按 **Enter** 兩次（不設密碼），或設一個你記得住的

然後印出公鑰，**整段複製起來**（`ssh-ed25519 AAAA...` 開頭）：

```powershell
Get-Content $env:USERPROFILE\.ssh\id_ed25519.pub
```

> 私鑰（`id_ed25519`，沒有 `.pub` 的那個）**絕對不要給任何人、不要貼進任何聊天室**。

> 不想用金鑰也可以：Vultr 會給你一組 root 密碼，跳過本小節，第 4 節改用密碼登入即可。但公開在網路上的機器會一直被人猜密碼，建議還是用金鑰。

### 2.3 在 Vultr 開機器

1. 到 <https://www.vultr.com/> 註冊帳號，依指示儲值
2. 左側 **Products** → 右上 **Deploy +** → **Deploy New Server**
3. 依序選擇：

   | 選項 | 選什麼 |
   |---|---|
   | Choose Type | **Cloud Compute – Shared CPU** |
   | Location | **Tokyo, Japan** 🇯🇵 |
   | Image | **Ubuntu** → **24.04 LTS x64** |
   | Plan | **Regular Cloud Compute**，2 vCPU / 4 GB RAM / 80 GB |
   | Auto Backups | 可關閉（會加約 20% 費用；我們自己有 `backup.sh`） |
   | IPv6 | 開著沒關係 |
   | SSH Keys | 按 **Add New** → 貼上 2.2 複製的公鑰 → 命名 `nic-windows` → 勾選它 |
   | Server Hostname | `n8n-nid` |

4. 右下 **Deploy Now**
5. 等 2–3 分鐘，狀態從 `Installing` 變成 **`Running`**
6. 點進這台機器，**記下 `IP Address`**（例如 `45.32.xxx.xxx`）

> Vultr 自己也有 Firewall 功能，這裡**不用設定**。安裝腳本會在機器內用 `ufw` 開好 22／80／443。

---

## 3. 設定 DNS A 記錄（5 分鐘 + 等生效）

到第 1 節查到的地方，新增一筆記錄：

| 欄位 | 填什麼 |
|---|---|
| 類型 Type | **A** |
| 名稱 Name／主機 Host | **`n8n`** ← 只填 `n8n`，不要填完整網域 |
| 值 Value／指向 Points to | 你的 VPS IP（例如 `45.32.xxx.xxx`） |
| TTL | Auto／自動／600 |

### WordPress.com 的實際操作（你的情況）

1. 開 <https://wordpress.com/domains/manage> 並登入
2. 點 **`niddesignlab.com`**
3. 找 **DNS 記錄 / DNS records**
   （直接網址：`https://wordpress.com/domains/manage/niddesignlab.com/dns/niddesignlab.com`）
4. 右上角按 **新增記錄**，填：

   | 欄位 | 填什麼 |
   |---|---|
   | TYPE | **A** ← 不是 CNAME |
   | 名稱 | **`n8n`** ← 只填 `n8n`，不要填完整網域 |
   | 欄位內容／指向 | 你的 VPS IP（例如 `45.32.10.20`） |

5. 儲存

> ⚠️ **不要照 `line` 那筆的樣子做。** 現有的 `line` 是 **CNAME** 指向
> `custom-domains.chatgpt.site`（舊系統託管在 OpenAI Sites）。
> n8n 是自己的 VPS，要用 **A 記錄指向 IP**，型別不同。

> ⚠️ **不要動任何既有記錄。** 特別是：
> - `A @`（主網站）
> - `CNAME www`（www 導向）
> - `CNAME line`（舊 LINE 系統）
> - `MX @`、`CNAME wpcloud1/2._domainkey`（公司信箱 `info@niddesignlab.com`）
>
> 只**新增** `n8n` 這一筆。改到上面任何一筆都會讓官網、舊系統或公司信箱掛掉。

⚠️ **WordPress.com 的 TTL 固定 3600 秒（1 小時）**，不像 Cloudflare 可以設 60 秒。
所以新記錄可能要等最多 1 小時才生效，**請務必等 `nslookup` 查得到才跑 `install.sh`**。

### 驗證是否生效

在 PowerShell：

```powershell
nslookup n8n.niddesignlab.com
```

看到 `Address:` 是你的 VPS IP 就成功了。

- 通常 1–10 分鐘生效，最慢可能要 1 小時
- 還沒生效會顯示 `找不到 n8n.niddesignlab.com` 或 `Non-existent domain`，**等一下再試，不要往下做**

---

## 4. 連線進 VPS

在 PowerShell（把 IP 換成你的）：

```powershell
ssh root@45.32.xxx.xxx
```

- 第一次連線會問 `Are you sure you want to continue connecting?` → 輸入 **`yes`** 按 Enter
- 用金鑰的話會直接登入
- 用密碼的話，貼上 Vultr 給的 root 密碼（**PowerShell 貼上是按滑鼠右鍵，密碼不會顯示出來，這是正常的**）

看到類似這樣就代表進去了：

```text
root@n8n-nid:~#
```

> Mac 使用者：開「終端機」執行同一行指令即可。

---

## 5. 下載專案並安裝

以下指令**一行一行**貼進去執行（在 VPS 裡，不是在 PowerShell 本機）。

### 5.1 取得專案

```bash
apt-get update && apt-get install -y git
```

```bash
git clone -b claude/line-assistant-n8n-integration-57c1w3 \
  https://github.com/nicko751031-a11y/NIDDESIGN.git /opt/niddesign
```

> ⚠️ **`-b claude/line-assistant-n8n-integration-57c1w3` 不能省略。**
> 這個 repo 的預設分支還沒有這些檔案，省略的話會 clone 到一個沒有 `infra/n8n/` 的版本。
> 等 PR #2 合併之後，就可以改用不加 `-b` 的一般寫法。

確認檔案有下來：

```bash
ls /opt/niddesign/infra/n8n
```

應該列出 `Caddyfile`、`README.md`、`backup.sh`、`docker-compose.yml`、`install.sh`、`.env.example`。
如果是空的或說 `No such file or directory`，代表分支名稱打錯了。

### 5.2 建立設定檔

```bash
cd /opt/niddesign/infra/n8n
cp .env.example .env
nano .env
```

`nano` 是文字編輯器。操作方式：

| 動作 | 按鍵 |
|---|---|
| 移動游標 | 方向鍵（**不能用滑鼠點**） |
| 貼上 | 滑鼠右鍵 |
| 存檔 | `Ctrl` + `O` → 按 `Enter` |
| 離開 | `Ctrl` + `X` |

**需要修改的三行**（其他先不用動）：

```ini
N8N_HOST=n8n.niddesignlab.com
ACME_EMAIL=nicko751031@gmail.com
LINE_CHANNEL_SECRET=<見下方 5.3>
```

- `N8N_ENCRYPTION_KEY` 和 `POSTGRES_PASSWORD` **留空就好**，安裝腳本會自動產生

### 5.3 取得 LINE Channel Secret

另開瀏覽器分頁：

1. 到 [LINE Developers Console – Basic settings](https://developers.line.biz/console/channel/2010874992/basic-info)
2. 找到 **`Channel secret`**，按複製
3. 回到 SSH 視窗，在 `nano` 裡把它貼在 `LINE_CHANNEL_SECRET=` 後面

改完按 `Ctrl+O` → `Enter` → `Ctrl+X`。

> 現在還不用改 LINE 的 Webhook URL。那是**最後一步**，改早了舊系統會提前斷線。

### 5.4 執行安裝

```bash
bash install.sh
```

腳本會自動做這些事，過程約 3–5 分鐘：

1. 安裝 Docker
2. 開防火牆（22／80／443）
3. 產生加密金鑰與資料庫密碼
4. 檢查 DNS 有沒有指到這台機器
5. 下載並啟動 n8n、PostgreSQL、Caddy

**中途如果出現黃色 `[!]` 警告**，看一下寫什麼：

| 警告 | 意思 | 怎麼辦 |
|---|---|---|
| `還沒有 DNS 記錄` | 第 3 節沒做或還沒生效 | 等生效後重跑 `bash install.sh` |
| `DNS 指向 X，但本機對外 IP 是 Y` | A 記錄填錯 IP | 回第 3 節修正 |
| `還沒有 DNS 記錄`，但你確定加過了 | 型別加成 CNAME 而不是 A | 刪掉重加一筆 **A** 記錄 |
| `LINE_CHANNEL_SECRET 尚未填寫` | 5.3 漏了 | 之後補填再 `docker compose up -d` |

看到這個畫面就成功了：

```text
============================================================
 完成。接下來：

 1. 開啟 https://n8n.niddesignlab.com/ 建立 n8n 管理員帳號
```

---

## 6. 驗證安裝結果

### 6.1 服務都在跑嗎

```bash
docker compose ps
```

三個服務的 `STATUS` 都要是 `Up` 或 `running`：

```text
NAME             SERVICE    STATUS
nid-n8n          n8n        Up 2 minutes
nid-n8n-caddy    caddy      Up 2 minutes
nid-n8n-db       postgres   Up 2 minutes (healthy)
```

### 6.2 網站打得開嗎

在瀏覽器開 **<https://n8n.niddesignlab.com/>**

- 出現 n8n 的註冊畫面 → **成功了** 🎉 建立管理員帳號（信箱＋密碼，請存進密碼管理器）
- 顯示憑證錯誤 → 第一次簽發要 10–30 秒，**等一下重整**
- 一直轉圈圈或連不上 → 看第 7 節

### 6.3 設定每日備份

```bash
crontab -e
```

第一次會問要用哪個編輯器，選 **`1`（nano）**。在檔案最後加上這一行：

```cron
0 3 * * * /opt/niddesign/infra/n8n/backup.sh >> /var/log/nid-n8n-backup.log 2>&1
```

`Ctrl+O` → `Enter` → `Ctrl+X` 存檔離開。

### 6.4 ⚠️ 把 .env 備份到你自己的電腦

**這一步不要跳過。**

```bash
cat /opt/niddesign/infra/n8n/.env
```

把整段內容複製下來，存進你的密碼管理器或一個安全的地方。

裡面的 `N8N_ENCRYPTION_KEY` 是 n8n 用來加密所有密鑰的鑰匙。**它遺失的話，n8n 裡存的 LINE Token、Notion Token、Anthropic Key、Dropbox 授權全部解不開，只能整套重建。** 只備份資料庫是救不回來的。

---

## 7. 卡關排除

### `ssh: connect to host ... Connection timed out`

- IP 打錯了 → 回 Vultr 後台確認
- 機器還在 `Installing` → 等它變 `Running`
- 公司網路擋了 22 port → 換手機熱點試試

### `Permission denied (publickey)`

金鑰沒有正確加到 Vultr。最快的解法是在 Vultr 後台：機器頁面 → **Settings → Change Root Password**，重設一組密碼後改用密碼登入。

### `bash: install.sh: No such file or directory`

沒有切換到正確目錄。執行：

```bash
cd /opt/niddesign/infra/n8n && ls
```

看得到 `install.sh` 才對。看不到就是 5.1 的分支名稱打錯，把 `/opt/niddesign` 刪掉重來：

```bash
rm -rf /opt/niddesign
```

### 網站打不開，或憑證一直錯

先看 Caddy 的日誌：

```bash
cd /opt/niddesign/infra/n8n && docker compose logs --tail=50 caddy
```

| 日誌關鍵字 | 原因 | 解法 |
|---|---|---|
| `no valid A/AAAA records` | DNS 沒指過來 | 回第 3 節 |
| `timeout` / `connection refused` during challenge | 80 port 被擋 | `ufw status` 確認 80 是 ALLOW |
| `too many certificates already issued` | 短時間重試太多次，被 Let's Encrypt 限流 | 等 1 小時後再試，期間不要重複重啟 |
| 一直沒有憑證相關訊息 | DNS 還沒生效（WordPress.com TTL 1 小時） | 等 `nslookup` 查得到後 `docker compose restart caddy` |

### `docker compose ps` 有服務是 `Restarting`

看那個服務的日誌：

```bash
docker compose logs --tail=50 n8n
```

最常見是 `.env` 有必填項留空。確認 `N8N_ENCRYPTION_KEY` 和 `POSTGRES_PASSWORD` 都有值：

```bash
grep -E 'N8N_ENCRYPTION_KEY|POSTGRES_PASSWORD' .env
```

兩行的 `=` 後面都要有一長串亂碼。空的話手動補：

```bash
echo "N8N_ENCRYPTION_KEY=$(openssl rand -hex 32)" >> .env
docker compose up -d
```

### 想整個砍掉重來

```bash
cd /opt/niddesign/infra/n8n
docker compose down -v      # -v 會連資料一起刪，確定要重來才加
rm -rf /opt/niddesign
```

然後從 5.1 重新開始。若連機器都想重開，在 Vultr 後台 Destroy 再 Deploy 一台，成本只有幾塊錢。

---

## 8. 完成後的下一步

到這裡你應該有：

- ✅ 一台跑著 n8n 的 VPS
- ✅ `https://n8n.niddesignlab.com/` 打得開，且是有效的 HTTPS
- ✅ n8n 管理員帳號
- ✅ 每日自動備份
- ✅ `.env` 已備份到你自己的電腦

接著回到 [`第一步-LINE串接n8n-建置指南.md`](第一步-LINE串接n8n-建置指南.md)：

- **第 6 節**：建立 4 組 Credential（LINE／Notion／Anthropic／Dropbox）
- **第 7 節**：匯入工作流
- **第 8 節**：切換 LINE Webhook ← 這一步之後舊系統就停止收訊，請確認前面都通了再做
- **第 9 節**：測試

---

## 附錄：常用指令速查

登入 VPS 後，先切到專案目錄：

```bash
cd /opt/niddesign/infra/n8n
```

| 想做什麼 | 指令 |
|---|---|
| 看服務狀態 | `docker compose ps` |
| 看即時日誌 | `docker compose logs -f n8n`（`Ctrl+C` 離開） |
| 重新啟動 | `docker compose restart n8n` |
| 改完 `.env` 後套用 | `docker compose up -d` |
| 升級 n8n | `docker compose pull && docker compose up -d` |
| 手動備份 | `bash backup.sh` |
| 更新專案程式 | `git pull && docker compose up -d` |
| 看硬碟剩多少 | `df -h` |
| 看記憶體 | `free -h` |
| 離開 SSH | `exit` |
