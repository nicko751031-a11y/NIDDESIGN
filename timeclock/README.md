# 川果設計 NID DESIGN LAB｜LINE 打卡系統

自建的 LINE 打卡系統（類似打卡之星），依台灣勞動法規設計。
與現有 LINE 助理相同技術棧：Cloudflare Workers + D1，可部署到 `clock.niddesignlab.com` 之類的子網域。

> 安全說明：本文件與程式碼不含任何密鑰。`ADMIN_TOKEN` 只存在 Cloudflare secret；
> LIFF ID 與 LINE Login Channel ID 非機密，設定於 `wrangler.toml`。

## 1. 法規要件對應

台灣沒有「打卡系統認證」制度——勞檢看的是出勤紀錄本身是否合規。本系統逐條對應：

| 法規 | 要求 | 系統實作 |
|---|---|---|
| 勞基法 §30 第5項 | 出勤紀錄逐日記載至分鐘 | 打卡一律取**伺服器時間**（保存到秒），記錄台北時區日期與時間 |
| 勞基法 §30 第5項 | 紀錄保存五年 | 資料僅附加不刪除；停用員工不刪紀錄；提供 `npm run db:backup` 匯出備份 |
| 勞基法 §30 第6項 | 勞工申請出勤紀錄副本不得拒絕 | 員工可在 LINE 內隨時自行下載個人出勤 CSV |
| 施行細則 §21 | 電腦出勤紀錄系統屬合法工具 | 本系統即屬「電腦出勤紀錄系統」 |
| 施行細則 §21 | 勞檢／勞工申請時以書面提出 | 管理端一鍵產出可列印的「出勤紀錄表」（含簽名欄，可另存 PDF） |
| 勞工在事業場所外工作時間指導原則 | 場所外可用 APP/GPS/通訊軟體記載 | LIFF + GPS；**範圍外仍可打卡**（外勤合法），僅標記供稽核 |
| 勞動部行政指導 | 出勤紀錄由勞雇雙方共同確認 | 員工每月線上按「確認本月出勤紀錄無誤」，管理端可查確認狀態 |
| 個資法 | GPS 定位屬個資，須告知並取得同意 | 打卡頁載明蒐集目的；拒絕定位仍可打卡（標示無定位） |

紀錄完整性設計（勞檢實務重點）：

- 打卡時間不採手機端時間，一律伺服器時間，防止調整手機時鐘造假。
- 原始打卡紀錄**不可修改、不可刪除**。忘打卡=管理員「補登」新紀錄並必填事由；
  打錯=「作廢」標記（原始時間內容仍完整保留）。
- 所有管理操作（新增員工、補登、作廢、改範圍…）寫入 `audit_log` 稽核軌跡。
- 一個員工綁定一個 LINE 帳號（LINE userId 唯一），access token 由 LINE 平台驗證，防代打卡與偽造。

## 2. 系統組成

```text
timeclock/
├── wrangler.toml        Cloudflare 部署設定（D1 綁定、環境變數）
├── schema.sql           D1 資料庫結構
├── src/index.js         Worker：員工 API + 管理 API + 報表產出
├── public/index.html    員工打卡頁（LIFF）：打卡、我的紀錄、下載副本、每月確認
├── public/admin.html    管理後台：員工/出勤/補登/打卡範圍/稽核軌跡
└── test/run.js          整合測試（node:sqlite 模擬 D1）
```

員工流程：LINE 選單開啟 LIFF → 首次輸入 6 碼綁定代碼 → 之後直接按「上班打卡／下班打卡」，
系統記錄伺服器時間 + GPS，並可切到「我的紀錄」查詢、下載 CSV、每月確認。

## 3. 部署步驟

前置：Node.js 22+、Cloudflare 帳號（與現有 LINE 助理同一個即可）。

### 3.1 LINE Developers 設定

打卡用 **LINE Login channel**（LIFF 掛在它下面），與現有 Messaging API channel（2010874992）互不影響：

1. 到 [LINE Developers Console](https://developers.line.biz/console/)，
   在現有 Provider（`2005386664`）下 **Create a new channel → LINE Login**。
2. 記下這個 channel 的 **Channel ID** → 填入 `wrangler.toml` 的 `LINE_LOGIN_CHANNEL_ID`。
3. 在該 channel 的 **LIFF** 分頁 → **Add**：
   - Size：`Full`
   - Endpoint URL：部署後的網址（例 `https://clock.niddesignlab.com/`）
   - Scopes：勾 `profile`
4. 記下 **LIFF ID**（格式 `1234567890-abcdefgh`）→ 填入 `wrangler.toml` 的 `LINE_LIFF_ID`。
5. 在官方帳號（@549mpmon）的圖文選單或快速回覆加一顆按鈕，
   連到 `https://liff.line.me/{LIFF_ID}`，員工點了就會開打卡頁。

### 3.2 Cloudflare 部署

```bash
cd timeclock
npm install
npx wrangler login

# 建立 D1 資料庫，把回傳的 database_id 填進 wrangler.toml
npx wrangler d1 create nid-timeclock

# 建立資料表
npm run db:migrate

# 設定管理後台密碼（自訂一串長隨機字串）
npx wrangler secret put ADMIN_TOKEN

# 部署
npm run deploy
```

部署後把 Worker 綁定自訂網域（Cloudflare dashboard → Workers → nid-timeclock →
Settings → Domains & Routes → 加 `clock.niddesignlab.com`），
再回 LINE Developers 把 LIFF Endpoint URL 改成正式網址。

### 3.3 開始使用

1. 開 `https://clock.niddesignlab.com/admin.html`，輸入 `ADMIN_TOKEN` 登入。
2. 「員工管理」新增員工 → 把 6 碼綁定代碼傳給員工。
3. 員工在 LINE 點打卡按鈕 → 輸入代碼綁定 → 開始打卡。
4. （選用）「打卡範圍」設定公司座標與半徑；範圍外打卡仍成功但會標記。

## 4. 日常營運與法遵作業

| 作業 | 頻率 | 方式 |
|---|---|---|
| 出勤月報 | 每月 | 管理後台「下載月報 CSV」（逐日、上下班、休息、工時） |
| 書面出勤紀錄表 | 每月／勞檢時 | 管理後台「書面出勤紀錄表」→ 列印或另存 PDF，勞雇簽名留存 |
| 員工確認 | 每月 | 提醒員工在 LINE「我的紀錄」按確認；後台可查確認狀態 |
| 資料備份（保存五年） | 每月 | `npm run db:backup` 匯出 SQL 檔，另存至公司雲端硬碟 |
| 忘打卡處理 | 隨時 | 後台「補登打卡」，必填事由，留稽核軌跡 |

員工報到時建議簽署個資告知同意（可併入勞動契約）：

> 本公司使用 LINE 電子打卡系統置備出勤紀錄（勞動基準法第30條）。打卡時系統將蒐集
> 你的 LINE 帳號識別碼、打卡時間及 GPS 位置，僅作出勤管理、工時計算與依法留存稽核
> 之用，保存五年，除法令要求外不為其他利用。你得依勞基法第30條第6項隨時於系統下載
> 個人出勤紀錄副本。

## 5. 測試

```bash
npm test          # 整合測試（36 項檢查：綁定、打卡、範圍、補登、作廢、報表、稽核…）
npm run dev       # 本機開發（先跑 npm run db:migrate:local）
```

## 6. 費用

- Cloudflare Workers / D1 免費額度對打卡量級（每人每天數次請求）綽綽有餘。
- LINE Login channel 與 LIFF 免費；打卡不發訊息，不占官方帳號訊息額度。
