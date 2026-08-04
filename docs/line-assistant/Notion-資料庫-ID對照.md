# Notion 資料庫 ID 對照表

建立日期：2026-08-04
Workspace：`Nic Yen的工作空間`（`a9472e8f-da61-81b8-bc02-0003daaec778`）
母頁面：[川果設計｜LINE 助理系統](https://app.notion.com/p/3b272e8fda6181be90ccc6e16358e007)

> n8n 設定資料庫節點時，填 **Database ID**。
> 若使用 Notion API `2025-09-03` 以上版本，改填 **Data Source ID**。

| 資料庫 | Database ID | Data Source ID | 連結 |
|---|---|---|---|
| 01｜專案 | `96295a88-0745-42be-a5db-b8cd0673ccd9` | `984e76d7-4702-42c7-94e9-32d3bb28f761` | [開啟](https://app.notion.com/p/96295a88074542bea5dbb8cd0673ccd9) |
| 02｜群組登錄 | `e8151c00-4fdb-4496-8b04-5b91b6cc018d` | `184b2f76-027f-4aa0-8e21-dec16615201e` | [開啟](https://app.notion.com/p/e8151c004fdb44968b045b91b6cc018d) |
| 03｜週報 | `47d6b48d-8f7c-4685-bde5-c1b1519a1313` | `71ae4920-d966-4fa6-a9b3-8b7b9f51d2aa` | [開啟](https://app.notion.com/p/47d6b48d8f7c4685bde5c1b1519a1313) |
| 04｜待辦事項 | `be48ac7f-19e8-4ecf-8067-71e036c76e87` | `ea7f8388-71fe-4250-9584-089e1b9608c9` | [開啟](https://app.notion.com/p/be48ac7f19e84ecf806771e036c76e87) |

## 關聯結構

```
01｜專案
 ├── 關聯群組      ←→ 02｜群組登錄.所屬專案
 ├── 週報          ←→ 03｜週報.專案
 └── 待辦事項      ←→ 04｜待辦事項.所屬專案

02｜群組登錄
 ├── 相關週報      ←→ 03｜週報.來源群組
 └── 產生的待辦    ←→ 04｜待辦事項.來源群組

03｜週報
 ├── 本週新增待辦  ←→ 04｜待辦事項.首次出現週報
 └── 本週提及待辦  ←→ 04｜待辦事項.最近更新週報
```

## 你需要手動做的事

Notion Integration 無法自行取得權限，必須由你在介面上授權：

1. 前往 https://www.notion.so/my-integrations 建立 Internal Integration（例如命名 `n8n-line-assistant`）
2. Capabilities 勾選 `Read content`、`Update content`、`Insert content`
3. 打開母頁面「川果設計｜LINE 助理系統」→ 右上 `⋯` → `連結`／`Connections` → 加入該 Integration
   - **從母頁面加入即可**，四個子資料庫會自動繼承權限
4. 複製 Integration Token（`ntn_…`）存入 n8n 憑證

> Token 不要貼進這個 repo、不要貼進 LINE 群組、不要截圖。

## 建議建立的檢視（View）

在 `03｜週報` 建這幾個 View，日後檢索會快很多：

| View 名稱 | 類型 | 設定 |
|---|---|---|
| 依週次 | Table | Group by `ISO 週次`，降冪 |
| 紅燈看板 | Table | Filter `風險等級` ≠ 正常 **或** `逾期待辦數` > 0 |
| 金額相關 | Table | Filter `涉及金額變動` = 勾選 |
| 依專案 | Board | Group by `專案` |
| 待核可 | Table | Filter `狀態` = 待核可（Pilot 期用） |

在 `04｜待辦事項`：

| View 名稱 | 類型 | 設定 |
|---|---|---|
| 卡住的事 | Table | Filter `連續追蹤週數` ≥ 3 且 `狀態` ≠ 已完成 |
| 本週到期 | Calendar | 依 `期限` |

## 變更紀錄

| 日期 | 變更 |
|---|---|
| 2026-08-04 | 建立四個資料庫與關聯；置入範例專案「文心南六路 / WXN6」 |
