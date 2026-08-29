# CLAUDE.md

本檔提供 Claude Code 在此儲存庫工作時的指引。

## 專案概觀

`NIDDESIGN` 目前是「川果設計 NID DESIGN LAB」的**文件儲存庫**，不含應用程式原始碼。

```text
docs/
└─ line-assistant/
   ├─ NIDLINE-系統設置文件-2026-07-28.md   # 系統交接、維護、測試、故障排查
   └─ 分析與紀錄-2026-07-28.md             # 第三方視角的分析、風險評估與事件紀錄
```

被記錄的 LINE 助理系統本身部署在 Cloudflare（Workers + D1 + R2），
正式站為 `https://line.niddesignlab.com/`，時區一律 `Asia/Taipei`。

## 文件慣例

- 文件以**繁體中文**撰寫；程式碼、指令與 API 欄位名稱保留英文原文。
- 檔名格式：`<主題>-<YYYY-MM-DD>.md`，日期為該版內容的更新日期。
- 每份文件開頭標註更新日期與文件用途。
- 更新既有文件時，一併更新檔頭日期；若屬重大改版則另建新日期檔案，保留舊版。

## 安全規則（不可違反）

- **任何密鑰都不得寫進本儲存庫**：Channel Secret、Access Token、OpenAI API Key、
  `ADMIN_TOKEN`、Railway Token 等，一律只存在部署環境變數與本機 `.env`。
- 文件中一律以 `RAILWAY_API_TOKEN`、`<PROJECT_TOKEN>` 之類的佔位符表示。
- 貼上指令輸出前先檢查是否含有密鑰或個資，必要時遮蔽。

---

## Railway Public API

Railway 只提供 **GraphQL** API，所有操作都是對單一端點發 HTTP `POST`。

| 項目 | 內容 |
|---|---|
| 端點 | `https://backboard.railway.com/graphql/v2` |
| 協定 | GraphQL over HTTP POST，body 為 `{"query": "...", "variables": {...}}` |
| 內容型別 | `Content-Type: application/json` |
| 內省（introspection） | 支援，可用 Postman／Insomnia／GraphiQL 直接抓 schema |
| 官方文件 | https://docs.railway.com/integrations/api |

> 注意：本容器的網路 egress 政策封鎖 `*.railway.com`，
> 因此無法在此 session 內直接呼叫 API 或抓取官方文件驗證。
> 需要實際呼叫時，請在本機或允許外連的環境執行。

### 認證

Token 種類不同，**送出的 header 也不同**，這是最常見的踩雷點：

| Token 種類 | Header | 權限範圍 |
|---|---|---|
| Account／Personal token | `Authorization: Bearer <TOKEN>` | 該帳號可存取的全部 workspace |
| Team token | `Authorization: Bearer <TOKEN>` | 指定 team／workspace |
| Project token | `Project-Access-Token: <TOKEN>` | 單一專案與環境（**不要**用 `Bearer`） |

Token 於 Railway Dashboard → Account Settings → Tokens 建立。

```bash
export RAILWAY_API_TOKEN='...'   # 只放在 shell 環境或 .env，勿寫入版控
```

### 基本呼叫

帳號 token（驗證 token 是否有效的最短查詢）：

```bash
curl -sS -X POST https://backboard.railway.com/graphql/v2 \
  -H "Authorization: Bearer $RAILWAY_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query":"query { me { id name email } }"}'
```

Project token（確認 token 綁定的專案與環境）：

```bash
curl -sS -X POST https://backboard.railway.com/graphql/v2 \
  -H "Project-Access-Token: $RAILWAY_PROJECT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query":"query { projectToken { projectId environmentId } }"}'
```

### 帶變數的查詢

```bash
curl -sS -X POST https://backboard.railway.com/graphql/v2 \
  -H "Authorization: Bearer $RAILWAY_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d @- <<'JSON'
{
  "query": "query Project($id: String!) { project(id: $id) { id name environments { edges { node { id name } } } services { edges { node { id name } } } } }",
  "variables": { "id": "<PROJECT_ID>" }
}
JSON
```

Railway 大量使用 Relay 風格的 `edges { node { ... } }` 連線結構，
取列表時記得往下鑽兩層。

### 常用 operation

查詢（query）：

| 用途 | Operation |
|---|---|
| 目前身分 | `me` |
| 專案清單／單一專案 | `projects`、`project(id:)` |
| 環境 | `environments`、`environment(id:)` |
| 服務 | `service(id:)`、`project { services }` |
| 部署清單 | `deployments(input: { projectId:, environmentId:, serviceId: })` |
| 部署紀錄 | `deploymentLogs(deploymentId:, limit:)` |
| 建置紀錄 | `buildLogs(deploymentId:)` |
| 環境變數 | `variables(projectId:, environmentId:, serviceId:)` |
| Project token 自身資訊 | `projectToken` |

變更（mutation）：

| 用途 | Operation |
|---|---|
| 建立服務 | `serviceCreate` |
| 觸發部署 | `deploymentTrigger` |
| 部署服務實例 | `serviceInstanceDeployV2` |
| 重新部署 | `serviceInstanceRedeploy` |
| 回滾部署 | `deploymentRollback` |
| 移除部署 | `deploymentRemove` |
| 新增／覆寫變數 | `variableUpsert` |
| 批次覆寫變數 | `variableCollectionUpsert` |
| 刪除變數 | `variableDelete` |

寫入變數的例子：

```bash
curl -sS -X POST https://backboard.railway.com/graphql/v2 \
  -H "Authorization: Bearer $RAILWAY_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d @- <<'JSON'
{
  "query": "mutation Set($input: VariableUpsertInput!) { variableUpsert(input: $input) }",
  "variables": {
    "input": {
      "projectId": "<PROJECT_ID>",
      "environmentId": "<ENVIRONMENT_ID>",
      "serviceId": "<SERVICE_ID>",
      "name": "EXAMPLE_KEY",
      "value": "<VALUE>"
    }
  }
}
JSON
```

schema 會演進，欄位與 input 型別以**內省結果為準**：

```bash
curl -sS -X POST https://backboard.railway.com/graphql/v2 \
  -H "Authorization: Bearer $RAILWAY_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query":"query { __type(name: \"Mutation\") { fields { name } } }"}'
```

### 錯誤處理與速率限制

- GraphQL 的慣例是**即使有錯也回 HTTP 200**，錯誤放在 body 的 `errors` 陣列，
  所以不要只看 status code，一定要檢查 `errors`。
- `401 / Not Authorized`：token 過期，或 project token 誤用了 `Authorization: Bearer`。
- `429`：超過速率限制。回應帶 `Retry-After`，另有 `X-RateLimit-*` 系列 header 可讀剩餘額度。
- Cloudflare `error 1015` 同樣是被限流，常見於「建立→輪詢→刪除」這類密集腳本。
- 實際額度依 workspace 方案（Free／Hobby／Pro／Enterprise）而不同，
  請以回應 header 為準，不要在程式裡寫死數字。
- 腳本請採指數退避重試（2s、4s、8s、16s），輪詢間隔不要低於數秒。

### CLI 替代方案

需要一次性操作時，Railway CLI 通常比手刻 GraphQL 省事：

```bash
railway login
railway link
railway variables            # 讀變數
railway logs                 # 讀紀錄
railway up                   # 部署
railway api                  # 直接發 GraphQL 請求，沿用 CLI 既有登入
```

CI 環境用 `RAILWAY_TOKEN` 環境變數取代互動式登入。

### 在此儲存庫使用時的規則

1. 範例一律使用環境變數與佔位符，**永不**貼上真實 token、projectId 以外的敏感值。
2. 新增 Railway 相關文件時放在 `docs/railway/`，沿用既有檔名日期慣例。
3. 若欄位或行為與本檔描述不符，以官方文件與內省結果為準，並回頭更新本檔。
