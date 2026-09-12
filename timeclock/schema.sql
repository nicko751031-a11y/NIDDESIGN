-- 川果設計 NID DESIGN LAB｜LINE 打卡系統 D1 資料庫結構
-- 法規對應：
--   勞基法第30條第5、6項：出勤紀錄逐日記載至分鐘、保存五年、勞工申請副本不得拒絕
--   勞基法施行細則第21條：電腦出勤紀錄系統屬合法工具，勞檢/勞工申請時須能以書面輸出
-- 設計原則：punches 為僅附加（append-only）紀錄，禁止修改原始打卡時間；
--   更正以「補登紀錄 + 作廢標記」呈現，原始資料永久保留，所有管理操作寫入 audit_log。

CREATE TABLE IF NOT EXISTS employees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  emp_no TEXT UNIQUE NOT NULL,          -- 員工編號
  name TEXT NOT NULL,                   -- 姓名
  line_user_id TEXT UNIQUE,             -- 綁定的 LINE userId（一人一帳號，防代打）
  line_display_name TEXT,               -- 綁定當下的 LINE 顯示名稱
  bind_code TEXT,                       -- 首次綁定用的一次性代碼
  active INTEGER NOT NULL DEFAULT 1,    -- 1=在職 0=停用（停用不刪除，保留歷史紀錄）
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS punches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  type TEXT NOT NULL,                   -- in / out / break_start / break_end
  punched_at TEXT NOT NULL,             -- 伺服器時間（UTC ISO 8601，不採用手機端時間）
  local_date TEXT NOT NULL,             -- 台北時區日期 YYYY-MM-DD（逐日記載）
  local_time TEXT NOT NULL,             -- 台北時區時間 HH:MM:SS（記載至分鐘以上）
  lat REAL,                             -- GPS 緯度（個資：需事先告知並取得同意）
  lng REAL,                             -- GPS 經度
  accuracy REAL,                        -- GPS 精度（公尺）
  in_range INTEGER,                     -- 1=在打卡範圍內 0=範圍外 NULL=未設定範圍/無定位
  source TEXT NOT NULL DEFAULT 'liff',  -- liff=員工本人打卡 / amendment=管理員補登
  note TEXT,                            -- 員工備註
  amend_reason TEXT,                    -- 補登事由（source=amendment 時必填）
  created_by TEXT NOT NULL,             -- employee:<LINE userId> 或 admin
  created_at TEXT NOT NULL,
  voided INTEGER NOT NULL DEFAULT 0,    -- 1=作廢（僅排除於計算，資料仍保留）
  void_reason TEXT,
  voided_at TEXT,
  voided_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_punches_emp_date ON punches(employee_id, local_date);
CREATE INDEX IF NOT EXISTS idx_punches_date ON punches(local_date);

-- 每月出勤紀錄勞雇雙方確認（勞動部行政指導建議）
CREATE TABLE IF NOT EXISTS monthly_confirmations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  month TEXT NOT NULL,                  -- YYYY-MM
  confirmed_at TEXT NOT NULL,           -- 員工確認時間（UTC ISO）
  line_user_id TEXT NOT NULL,           -- 確認當下的 LINE userId
  UNIQUE(employee_id, month)
);

-- 管理操作稽核軌跡（誰、何時、做了什麼）
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  detail TEXT                           -- JSON 詳細內容
);

-- 系統設定（打卡範圍等）
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
