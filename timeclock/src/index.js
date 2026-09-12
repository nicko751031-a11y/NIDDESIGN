// 川果設計 NID DESIGN LAB｜LINE 打卡系統
//
// 法規要件對應（台灣勞動基準法）：
//   §30 V   出勤紀錄逐日記載至分鐘      → punches.local_date / local_time（伺服器時間）
//   §30 V   保存五年                    → 資料僅附加不刪除；提供 D1 匯出備份指令
//   §30 VI  勞工申請副本不得拒絕        → 員工可自行下載個人出勤 CSV（/api/me/export）
//   細則§21 勞檢時以書面方式提出        → 管理端可列印出勤紀錄表（/api/admin/report）
//   指導原則 場所外工作以 APP/GPS 記載  → LIFF + Geolocation，範圍外仍可打卡並標記
//   行政指導 勞雇雙方共同確認出勤紀錄  → 員工每月線上確認（monthly_confirmations）
//
// 紀錄完整性：
//   - 打卡時間一律取伺服器時間，不採用手機端時間
//   - punches 原始紀錄不可修改；更正=補登新紀錄(amendment)+作廢標記(voided)
//   - 所有管理操作寫入 audit_log

const PUNCH_TYPES = {
  in: '上班',
  out: '下班',
  break_start: '休息開始',
  break_end: '休息結束',
};

const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000; // Asia/Taipei 固定 UTC+8，無日光節約

// ---------- 時間工具 ----------

export function taipeiParts(date) {
  const t = new Date(date.getTime() + TAIPEI_OFFSET_MS);
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return {
    date: `${t.getUTCFullYear()}-${p(t.getUTCMonth() + 1)}-${p(t.getUTCDate())}`,
    time: `${p(t.getUTCHours())}:${p(t.getUTCMinutes())}:${p(t.getUTCSeconds())}`,
    weekday: '日一二三四五六'[t.getUTCDay()],
  };
}

export function isValidMonth(m) {
  return typeof m === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(m);
}

// ---------- 出勤計算 ----------

// 兩點間距離（公尺），Haversine
export function distanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// 將某員工某月的有效打卡整理成逐日摘要
// punches: 已按 punched_at 排序、未作廢的紀錄
export function computeDailySummary(punches) {
  const byDate = new Map();
  for (const p of punches) {
    if (!byDate.has(p.local_date)) byDate.set(p.local_date, []);
    byDate.get(p.local_date).push(p);
  }
  const days = [];
  for (const [date, list] of byDate) {
    const firstIn = list.find((p) => p.type === 'in');
    const outs = list.filter((p) => p.type === 'out');
    const lastOut = outs.length ? outs[outs.length - 1] : null;
    let workMinutes = null;
    let breakMinutes = 0;
    if (firstIn && lastOut) {
      workMinutes = Math.round(
        (new Date(lastOut.punched_at) - new Date(firstIn.punched_at)) / 60000
      );
      // 成對的休息時間予以扣除
      let bs = null;
      for (const p of list) {
        if (p.type === 'break_start') bs = p;
        else if (p.type === 'break_end' && bs) {
          breakMinutes += Math.round(
            (new Date(p.punched_at) - new Date(bs.punched_at)) / 60000
          );
          bs = null;
        }
      }
      workMinutes -= breakMinutes;
    }
    days.push({
      date,
      punches: list,
      firstIn: firstIn ? firstIn.local_time : null,
      lastOut: lastOut ? lastOut.local_time : null,
      breakMinutes,
      workMinutes,
      hasAmendment: list.some((p) => p.source === 'amendment'),
    });
  }
  days.sort((a, b) => (a.date < b.date ? -1 : 1));
  return days;
}

// ---------- 回應工具 ----------

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });

const err = (status, message) => json({ error: message }, status);

function csvResponse(rows, filename) {
  const esc = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const body = '﻿' + rows.map((r) => r.map(esc).join(',')).join('\r\n');
  return new Response(body, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  });
}

// ---------- LINE 身分驗證 ----------

// 以 LINE 平台驗證 access token（防偽造），並取得 userId
async function verifyLineUser(accessToken, env) {
  if (!accessToken) return null;
  const v = await fetch(
    'https://api.line.me/oauth2/v2.1/verify?access_token=' +
      encodeURIComponent(accessToken)
  );
  if (!v.ok) return null;
  const info = await v.json();
  const expected = env.LINE_LOGIN_CHANNEL_ID;
  if (expected && !String(expected).startsWith('REPLACE') && info.client_id !== expected) {
    return null;
  }
  const p = await fetch('https://api.line.me/v2/profile', {
    headers: { authorization: 'Bearer ' + accessToken },
  });
  if (!p.ok) return null;
  const prof = await p.json();
  return { userId: prof.userId, displayName: prof.displayName || '' };
}

async function requireEmployee(req, env, body) {
  const token =
    (body && body.accessToken) || req.headers.get('x-line-access-token');
  const user = await verifyLineUser(token, env);
  if (!user) return { error: err(401, 'LINE 身分驗證失敗，請重新開啟打卡頁') };
  const emp = await env.DB.prepare(
    'SELECT * FROM employees WHERE line_user_id = ? AND active = 1'
  )
    .bind(user.userId)
    .first();
  return { user, emp };
}

function requireAdmin(req, env) {
  const auth = req.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  return Boolean(env.ADMIN_TOKEN) && token === env.ADMIN_TOKEN;
}

async function audit(env, actor, action, detail) {
  await env.DB.prepare(
    'INSERT INTO audit_log (at, actor, action, detail) VALUES (?, ?, ?, ?)'
  )
    .bind(new Date().toISOString(), actor, action, JSON.stringify(detail || {}))
    .run();
}

async function getGeofence(env) {
  const row = await env.DB.prepare(
    "SELECT value FROM settings WHERE key = 'geofence'"
  ).first();
  if (!row || !row.value) return null;
  try {
    const g = JSON.parse(row.value);
    if (typeof g.lat === 'number' && typeof g.lng === 'number' && g.radius_m > 0)
      return g;
  } catch {}
  return null;
}

// ---------- 員工端 API ----------

async function handleBind(req, env) {
  const body = await req.json().catch(() => ({}));
  const user = await verifyLineUser(body.accessToken, env);
  if (!user) return err(401, 'LINE 身分驗證失敗');
  const code = String(body.bindCode || '').trim();
  if (!code) return err(400, '請輸入綁定代碼');
  const emp = await env.DB.prepare(
    'SELECT * FROM employees WHERE bind_code = ? AND active = 1'
  )
    .bind(code)
    .first();
  if (!emp) return err(404, '綁定代碼不正確，請向管理員確認');
  if (emp.line_user_id && emp.line_user_id !== user.userId)
    return err(409, '此員工已綁定其他 LINE 帳號，請向管理員申請重新綁定');
  const dup = await env.DB.prepare(
    'SELECT id FROM employees WHERE line_user_id = ? AND id != ?'
  )
    .bind(user.userId, emp.id)
    .first();
  if (dup) return err(409, '此 LINE 帳號已綁定其他員工');
  await env.DB.prepare(
    'UPDATE employees SET line_user_id = ?, line_display_name = ?, bind_code = NULL WHERE id = ?'
  )
    .bind(user.userId, user.displayName, emp.id)
    .run();
  await audit(env, 'employee:' + user.userId, 'bind', {
    employee_id: emp.id,
    emp_no: emp.emp_no,
  });
  return json({ ok: true, employee: { name: emp.name, emp_no: emp.emp_no } });
}

async function handleWhoami(req, env) {
  const { error, emp, user } = await requireEmployee(req, env, null);
  if (error) return error;
  if (!emp) return json({ bound: false });
  return json({
    bound: true,
    employee: { name: emp.name, emp_no: emp.emp_no },
    displayName: user.displayName,
  });
}

async function handlePunch(req, env) {
  const body = await req.json().catch(() => ({}));
  const { error, emp, user } = await requireEmployee(req, env, body);
  if (error) return error;
  if (!emp) return err(403, '尚未完成員工綁定');
  const type = body.type;
  if (!PUNCH_TYPES[type]) return err(400, '打卡類別不正確');

  // 打卡時間一律使用伺服器時間（勞基法要求記至分鐘，這裡保存到秒）
  const now = new Date();
  const { date, time } = taipeiParts(now);

  const lat = Number.isFinite(body.lat) ? body.lat : null;
  const lng = Number.isFinite(body.lng) ? body.lng : null;
  const accuracy = Number.isFinite(body.accuracy) ? body.accuracy : null;

  // 地理範圍檢查：範圍外仍允許打卡（外勤合法），但標記供管理端稽核
  let inRange = null;
  const fence = await getGeofence(env);
  if (fence && lat !== null && lng !== null) {
    inRange =
      distanceMeters(lat, lng, fence.lat, fence.lng) <= fence.radius_m ? 1 : 0;
  }

  // 防止同類別 60 秒內重複打卡
  const recent = await env.DB.prepare(
    `SELECT punched_at FROM punches WHERE employee_id = ? AND type = ? AND voided = 0
     ORDER BY punched_at DESC LIMIT 1`
  )
    .bind(emp.id, type)
    .first();
  if (recent && now - new Date(recent.punched_at) < 60000)
    return err(429, '剛剛已打過同類別的卡，請稍候再試');

  await env.DB.prepare(
    `INSERT INTO punches
       (employee_id, type, punched_at, local_date, local_time, lat, lng, accuracy,
        in_range, source, note, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'liff', ?, ?, ?)`
  )
    .bind(
      emp.id,
      type,
      now.toISOString(),
      date,
      time,
      lat,
      lng,
      accuracy,
      inRange,
      body.note ? String(body.note).slice(0, 200) : null,
      'employee:' + user.userId,
      now.toISOString()
    )
    .run();

  return json({
    ok: true,
    type,
    typeLabel: PUNCH_TYPES[type],
    date,
    time,
    inRange,
    employee: emp.name,
  });
}

async function handleMyRecords(req, env, url) {
  const { error, emp } = await requireEmployee(req, env, null);
  if (error) return error;
  if (!emp) return err(403, '尚未完成員工綁定');
  const month = url.searchParams.get('month');
  if (!isValidMonth(month)) return err(400, '月份格式須為 YYYY-MM');
  const { results } = await env.DB.prepare(
    `SELECT id, type, local_date, local_time, in_range, source, note, amend_reason, voided
     FROM punches WHERE employee_id = ? AND local_date LIKE ?
     ORDER BY punched_at`
  )
    .bind(emp.id, month + '-%')
    .all();
  const confirmed = await env.DB.prepare(
    'SELECT confirmed_at FROM monthly_confirmations WHERE employee_id = ? AND month = ?'
  )
    .bind(emp.id, month)
    .first();
  return json({
    employee: { name: emp.name, emp_no: emp.emp_no },
    month,
    punches: results,
    typeLabels: PUNCH_TYPES,
    confirmedAt: confirmed ? confirmed.confirmed_at : null,
  });
}

// 勞基法§30VI：勞工申請出勤紀錄副本，雇主不得拒絕 → 員工可自行下載
async function handleMyExport(req, env, url) {
  const { error, emp } = await requireEmployee(req, env, null);
  if (error) return error;
  if (!emp) return err(403, '尚未完成員工綁定');
  const month = url.searchParams.get('month');
  if (!isValidMonth(month)) return err(400, '月份格式須為 YYYY-MM');
  const { results } = await env.DB.prepare(
    `SELECT * FROM punches WHERE employee_id = ? AND local_date LIKE ? ORDER BY punched_at`
  )
    .bind(emp.id, month + '-%')
    .all();
  const rows = [
    ['員工編號', '姓名', '日期', '時間', '類別', '來源', '範圍內', '備註', '補登事由', '作廢'],
    ...results.map((p) => [
      emp.emp_no,
      emp.name,
      p.local_date,
      p.local_time,
      PUNCH_TYPES[p.type] || p.type,
      p.source === 'amendment' ? '補登' : '本人打卡',
      p.in_range === null ? '' : p.in_range ? '是' : '否',
      p.note || '',
      p.amend_reason || '',
      p.voided ? '是' : '',
    ]),
  ];
  return csvResponse(rows, `出勤紀錄_${emp.emp_no}_${month}.csv`);
}

// 勞雇雙方共同確認出勤紀錄（勞動部行政指導建議）
async function handleMyConfirm(req, env) {
  const body = await req.json().catch(() => ({}));
  const { error, emp, user } = await requireEmployee(req, env, body);
  if (error) return error;
  if (!emp) return err(403, '尚未完成員工綁定');
  const month = body.month;
  if (!isValidMonth(month)) return err(400, '月份格式須為 YYYY-MM');
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO monthly_confirmations (employee_id, month, confirmed_at, line_user_id)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(employee_id, month) DO NOTHING`
  )
    .bind(emp.id, month, now, user.userId)
    .run();
  await audit(env, 'employee:' + user.userId, 'confirm_month', {
    employee_id: emp.id,
    month,
  });
  return json({ ok: true, month, confirmedAt: now });
}

// ---------- 管理端 API ----------

function randomBindCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  const buf = new Uint8Array(6);
  crypto.getRandomValues(buf);
  for (const b of buf) s += chars[b % chars.length];
  return s;
}

async function adminEmployees(req, env) {
  if (req.method === 'GET') {
    const { results } = await env.DB.prepare(
      'SELECT id, emp_no, name, line_user_id, line_display_name, bind_code, active, created_at FROM employees ORDER BY emp_no'
    ).all();
    return json({ employees: results });
  }
  if (req.method === 'POST') {
    const body = await req.json().catch(() => ({}));
    const empNo = String(body.emp_no || '').trim();
    const name = String(body.name || '').trim();
    if (!empNo || !name) return err(400, '員工編號與姓名必填');
    const code = randomBindCode();
    try {
      await env.DB.prepare(
        'INSERT INTO employees (emp_no, name, bind_code, created_at) VALUES (?, ?, ?, ?)'
      )
        .bind(empNo, name, code, new Date().toISOString())
        .run();
    } catch (e) {
      return err(409, '員工編號已存在');
    }
    await audit(env, 'admin', 'create_employee', { emp_no: empNo, name });
    return json({ ok: true, emp_no: empNo, bind_code: code });
  }
  return err(405, 'method not allowed');
}

async function adminEmployeePatch(req, env, id) {
  const body = await req.json().catch(() => ({}));
  const emp = await env.DB.prepare('SELECT * FROM employees WHERE id = ?')
    .bind(id)
    .first();
  if (!emp) return err(404, '查無員工');
  const updates = {};
  if (body.action === 'deactivate') {
    await env.DB.prepare('UPDATE employees SET active = 0 WHERE id = ?').bind(id).run();
    updates.active = 0;
  } else if (body.action === 'activate') {
    await env.DB.prepare('UPDATE employees SET active = 1 WHERE id = ?').bind(id).run();
    updates.active = 1;
  } else if (body.action === 'rebind') {
    // 解除 LINE 綁定並產生新代碼（換手機/換帳號時使用）
    const code = randomBindCode();
    await env.DB.prepare(
      'UPDATE employees SET line_user_id = NULL, line_display_name = NULL, bind_code = ? WHERE id = ?'
    )
      .bind(code, id)
      .run();
    updates.bind_code = code;
  } else if (body.name) {
    await env.DB.prepare('UPDATE employees SET name = ? WHERE id = ?')
      .bind(String(body.name).trim(), id)
      .run();
    updates.name = body.name;
  } else {
    return err(400, '不支援的操作');
  }
  await audit(env, 'admin', 'update_employee', { id, emp_no: emp.emp_no, ...updates });
  return json({ ok: true, ...updates });
}

async function adminPunches(req, env, url) {
  if (req.method === 'GET') {
    const month = url.searchParams.get('month');
    if (!isValidMonth(month)) return err(400, '月份格式須為 YYYY-MM');
    const empId = url.searchParams.get('employee_id');
    let q = `SELECT p.*, e.name AS employee_name, e.emp_no
             FROM punches p JOIN employees e ON e.id = p.employee_id
             WHERE p.local_date LIKE ?`;
    const binds = [month + '-%'];
    if (empId) {
      q += ' AND p.employee_id = ?';
      binds.push(empId);
    }
    q += ' ORDER BY p.punched_at';
    const { results } = await env.DB.prepare(q).bind(...binds).all();
    return json({ punches: results, typeLabels: PUNCH_TYPES });
  }
  if (req.method === 'POST') {
    // 補登（忘打卡）：以新紀錄呈現，需填事由，原始紀錄不受影響
    const body = await req.json().catch(() => ({}));
    const emp = await env.DB.prepare('SELECT * FROM employees WHERE id = ?')
      .bind(body.employee_id)
      .first();
    if (!emp) return err(404, '查無員工');
    if (!PUNCH_TYPES[body.type]) return err(400, '打卡類別不正確');
    const reason = String(body.reason || '').trim();
    if (!reason) return err(400, '補登必須填寫事由');
    const when = new Date(body.punched_at);
    if (isNaN(when)) return err(400, '時間格式不正確');
    if (when > new Date()) return err(400, '補登時間不可在未來');
    const { date, time } = taipeiParts(when);
    const now = new Date().toISOString();
    const r = await env.DB.prepare(
      `INSERT INTO punches
         (employee_id, type, punched_at, local_date, local_time,
          source, amend_reason, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, 'amendment', ?, 'admin', ?)`
    )
      .bind(emp.id, body.type, when.toISOString(), date, time, reason, now)
      .run();
    await audit(env, 'admin', 'amend_punch', {
      employee_id: emp.id,
      emp_no: emp.emp_no,
      type: body.type,
      punched_at: when.toISOString(),
      reason,
    });
    return json({ ok: true, id: r.meta.last_row_id, date, time });
  }
  return err(405, 'method not allowed');
}

async function adminVoidPunch(req, env, id) {
  const body = await req.json().catch(() => ({}));
  const reason = String(body.reason || '').trim();
  if (!reason) return err(400, '作廢必須填寫事由');
  const p = await env.DB.prepare('SELECT * FROM punches WHERE id = ?').bind(id).first();
  if (!p) return err(404, '查無紀錄');
  if (p.voided) return err(409, '此紀錄已作廢');
  // 作廢僅標記，原始打卡時間與內容永久保留（出勤紀錄不可竄改）
  await env.DB.prepare(
    'UPDATE punches SET voided = 1, void_reason = ?, voided_at = ?, voided_by = ? WHERE id = ?'
  )
    .bind(reason, new Date().toISOString(), 'admin', id)
    .run();
  await audit(env, 'admin', 'void_punch', { punch_id: id, reason, original: p });
  return json({ ok: true });
}

async function adminSettings(req, env) {
  if (req.method === 'GET') {
    const fence = await getGeofence(env);
    return json({ geofence: fence });
  }
  if (req.method === 'PUT') {
    const body = await req.json().catch(() => ({}));
    if (body.geofence === null) {
      await env.DB.prepare("DELETE FROM settings WHERE key = 'geofence'").run();
      await audit(env, 'admin', 'clear_geofence', {});
      return json({ ok: true, geofence: null });
    }
    const g = body.geofence || {};
    if (
      typeof g.lat !== 'number' ||
      typeof g.lng !== 'number' ||
      !(g.radius_m > 0)
    )
      return err(400, 'geofence 需含 lat, lng, radius_m');
    const value = JSON.stringify({
      lat: g.lat,
      lng: g.lng,
      radius_m: g.radius_m,
      name: String(g.name || '').slice(0, 50),
    });
    await env.DB.prepare(
      "INSERT INTO settings (key, value) VALUES ('geofence', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
    )
      .bind(value)
      .run();
    await audit(env, 'admin', 'set_geofence', JSON.parse(value));
    return json({ ok: true });
  }
  return err(405, 'method not allowed');
}

async function loadMonthData(env, month, empId) {
  let q = 'SELECT id, emp_no, name, active FROM employees';
  const binds = [];
  if (empId) {
    q += ' WHERE id = ?';
    binds.push(empId);
  }
  q += ' ORDER BY emp_no';
  const { results: employees } = await env.DB.prepare(q).bind(...binds).all();
  const data = [];
  for (const e of employees) {
    const { results: punches } = await env.DB.prepare(
      `SELECT * FROM punches WHERE employee_id = ? AND local_date LIKE ? AND voided = 0
       ORDER BY punched_at`
    )
      .bind(e.id, month + '-%')
      .all();
    if (!punches.length && empId === null && !e.active) continue;
    const confirmed = await env.DB.prepare(
      'SELECT confirmed_at FROM monthly_confirmations WHERE employee_id = ? AND month = ?'
    )
      .bind(e.id, month)
      .first();
    data.push({
      employee: e,
      days: computeDailySummary(punches),
      confirmedAt: confirmed ? confirmed.confirmed_at : null,
    });
  }
  return data;
}

async function adminExport(req, env, url) {
  const month = url.searchParams.get('month');
  if (!isValidMonth(month)) return err(400, '月份格式須為 YYYY-MM');
  const empId = url.searchParams.get('employee_id') || null;
  const data = await loadMonthData(env, month, empId);
  const rows = [
    [
      '員工編號', '姓名', '日期', '星期', '上班', '下班',
      '休息(分)', '工作時數(分)', '工作時數(時)', '含補登', '當日打卡明細',
    ],
  ];
  for (const d of data) {
    for (const day of d.days) {
      const wd = taipeiParts(new Date(day.date + 'T04:00:00Z')).weekday;
      rows.push([
        d.employee.emp_no,
        d.employee.name,
        day.date,
        wd,
        day.firstIn || '',
        day.lastOut || '',
        day.breakMinutes || 0,
        day.workMinutes === null ? '' : day.workMinutes,
        day.workMinutes === null ? '' : (day.workMinutes / 60).toFixed(2),
        day.hasAmendment ? '是' : '',
        day.punches
          .map(
            (p) =>
              `${p.local_time} ${PUNCH_TYPES[p.type] || p.type}${p.source === 'amendment' ? '(補)' : ''}`
          )
          .join('; '),
      ]);
    }
  }
  return csvResponse(rows, `出勤月報_${month}.csv`);
}

// 書面出勤紀錄表（勞基法施行細則§21：勞檢或勞工申請時以書面提出 → 直接列印/另存 PDF）
async function adminReport(req, env, url) {
  const month = url.searchParams.get('month');
  if (!isValidMonth(month)) return err(400, '月份格式須為 YYYY-MM');
  const empId = url.searchParams.get('employee_id') || null;
  const data = await loadMonthData(env, month, empId);
  const company = env.COMPANY_NAME || '';
  const esc = (s) =>
    String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  let sections = '';
  for (const d of data) {
    const rowsHtml = d.days
      .map((day) => {
        const wd = taipeiParts(new Date(day.date + 'T04:00:00Z')).weekday;
        const detail = day.punches
          .map(
            (p) =>
              `${esc(p.local_time)} ${esc(PUNCH_TYPES[p.type] || p.type)}${p.source === 'amendment' ? `（補登：${esc(p.amend_reason || '')}）` : ''}`
          )
          .join('<br>');
        return `<tr>
          <td>${esc(day.date)}</td><td>${wd}</td>
          <td>${esc(day.firstIn || '—')}</td><td>${esc(day.lastOut || '—')}</td>
          <td class="num">${day.breakMinutes || 0}</td>
          <td class="num">${day.workMinutes === null ? '—' : day.workMinutes}</td>
          <td class="detail">${detail}</td>
        </tr>`;
      })
      .join('');
    const totalMin = d.days.reduce((s, x) => s + (x.workMinutes || 0), 0);
    sections += `<section class="emp">
      <h2>${esc(d.employee.name)}（員工編號 ${esc(d.employee.emp_no)}）</h2>
      <table>
        <thead><tr><th>日期</th><th>星期</th><th>上班</th><th>下班</th><th>休息(分)</th><th>工作(分)</th><th>打卡明細（記載至分鐘）</th></tr></thead>
        <tbody>${rowsHtml || '<tr><td colspan="7">本月無出勤紀錄</td></tr>'}</tbody>
        <tfoot><tr><td colspan="5">本月合計</td><td class="num">${totalMin} 分</td><td>${(totalMin / 60).toFixed(2)} 小時</td></tr></tfoot>
      </table>
      <p class="confirm">勞工線上確認：${d.confirmedAt ? esc(d.confirmedAt.slice(0, 10)) + ' 已確認' : '尚未確認'}</p>
      <div class="sign"><span>勞工簽名：＿＿＿＿＿＿＿＿</span><span>雇主/主管簽名：＿＿＿＿＿＿＿＿</span><span>日期：＿＿＿＿＿＿＿＿</span></div>
    </section>`;
  }

  const html = `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8">
<title>出勤紀錄表 ${esc(month)}</title>
<style>
  body{font-family:"Microsoft JhengHei","PingFang TC",sans-serif;margin:24px;color:#111}
  h1{font-size:20px} h2{font-size:16px;margin:24px 0 8px}
  table{border-collapse:collapse;width:100%;font-size:12px}
  th,td{border:1px solid #444;padding:4px 6px;text-align:left;vertical-align:top}
  td.num{text-align:right} td.detail{font-size:11px}
  tfoot td{font-weight:bold}
  .meta{font-size:12px;color:#333}
  .sign{display:flex;gap:32px;margin:16px 0;font-size:13px}
  .confirm{font-size:12px}
  .legal{font-size:10px;color:#555;margin-top:24px;border-top:1px solid #999;padding-top:8px}
  @media print{.noprint{display:none} section.emp{page-break-after:always}}
</style></head><body>
<div class="noprint" style="margin-bottom:12px"><button onclick="print()">列印 / 另存 PDF</button></div>
<h1>${esc(company)}｜出勤紀錄表（${esc(month)}）</h1>
<p class="meta">本表由電腦出勤紀錄系統產出（勞動基準法施行細則第21條）。打卡時間以伺服器時間逐日記載至分鐘；補登與作廢均留有稽核軌跡。產出時間：${esc(taipeiParts(new Date()).date)} ${esc(taipeiParts(new Date()).time)}（台北時間）</p>
${sections || '<p>查無資料</p>'}
<p class="legal">依勞動基準法第30條第5項，本出勤紀錄應保存五年；同條第6項，勞工向雇主申請其出勤紀錄副本或影本時，雇主不得拒絕。</p>
</body></html>`;
  return new Response(html, {
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}

async function adminConfirmations(req, env, url) {
  const month = url.searchParams.get('month');
  if (!isValidMonth(month)) return err(400, '月份格式須為 YYYY-MM');
  const { results } = await env.DB.prepare(
    `SELECT c.month, c.confirmed_at, e.emp_no, e.name
     FROM monthly_confirmations c JOIN employees e ON e.id = c.employee_id
     WHERE c.month = ? ORDER BY e.emp_no`
  )
    .bind(month)
    .all();
  return json({ confirmations: results });
}

async function adminAudit(req, env, url) {
  const limit = Math.min(Number(url.searchParams.get('limit')) || 100, 500);
  const { results } = await env.DB.prepare(
    'SELECT * FROM audit_log ORDER BY id DESC LIMIT ?'
  )
    .bind(limit)
    .all();
  return json({ audit: results });
}

// ---------- 路由 ----------

export async function handleRequest(req, env) {
  const url = new URL(req.url);
  const path = url.pathname;

  // 公開設定（LIFF ID 非機密）
  if (path === '/api/config')
    return json({
      liffId: env.LINE_LIFF_ID || '',
      companyName: env.COMPANY_NAME || '',
    });

  // 員工端
  if (path === '/api/bind' && req.method === 'POST') return handleBind(req, env);
  if (path === '/api/me' && req.method === 'GET') return handleWhoami(req, env);
  if (path === '/api/punch' && req.method === 'POST') return handlePunch(req, env);
  if (path === '/api/me/records' && req.method === 'GET')
    return handleMyRecords(req, env, url);
  if (path === '/api/me/export' && req.method === 'GET')
    return handleMyExport(req, env, url);
  if (path === '/api/me/confirm' && req.method === 'POST')
    return handleMyConfirm(req, env);

  // 管理端
  if (path.startsWith('/api/admin/')) {
    if (!requireAdmin(req, env)) return err(401, '管理權限驗證失敗');
    if (path === '/api/admin/employees') return adminEmployees(req, env);
    const mEmp = path.match(/^\/api\/admin\/employees\/(\d+)$/);
    if (mEmp && req.method === 'PATCH')
      return adminEmployeePatch(req, env, Number(mEmp[1]));
    if (path === '/api/admin/punches') return adminPunches(req, env, url);
    const mVoid = path.match(/^\/api\/admin\/punches\/(\d+)\/void$/);
    if (mVoid && req.method === 'POST')
      return adminVoidPunch(req, env, Number(mVoid[1]));
    if (path === '/api/admin/settings') return adminSettings(req, env);
    if (path === '/api/admin/export') return adminExport(req, env, url);
    if (path === '/api/admin/report') return adminReport(req, env, url);
    if (path === '/api/admin/confirmations')
      return adminConfirmations(req, env, url);
    if (path === '/api/admin/audit') return adminAudit(req, env, url);
    return err(404, 'not found');
  }

  if (path.startsWith('/api/')) return err(404, 'not found');

  // 其餘交給靜態資源（public/）
  return env.ASSETS.fetch(req);
}

export default {
  fetch: (req, env) => handleRequest(req, env),
};
