// 整合測試：以 node:sqlite 模擬 Cloudflare D1、攔截 LINE API，直接呼叫 worker 的 handleRequest
// 執行：npm test
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import {
  handleRequest,
  taipeiParts,
  computeDailySummary,
  distanceMeters,
  isValidMonth,
} from '../src/index.js';

// ---------- D1 模擬 ----------
function makeD1(db) {
  const norm = (v) => (v === undefined ? null : v);
  return {
    prepare(sql) {
      const make = (args) => ({
        bind: (...a) => make(a),
        first: () => {
          const r = db.prepare(sql).get(...args);
          return Promise.resolve(r === undefined ? null : r);
        },
        all: () => Promise.resolve({ results: db.prepare(sql).all(...args) }),
        run: () => {
          const r = db.prepare(sql).run(...args);
          return Promise.resolve({ meta: { last_row_id: Number(r.lastInsertRowid) } });
        },
      });
      return make([]);
    },
  };
}

// ---------- LINE API 模擬 ----------
const VALID_TOKENS = {
  'token-amy': { userId: 'U-amy', displayName: 'Amy' },
  'token-bob': { userId: 'U-bob', displayName: 'Bob' },
};
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input.url;
  if (url.startsWith('https://api.line.me/oauth2/v2.1/verify')) {
    const token = new URL(url).searchParams.get('access_token');
    if (VALID_TOKENS[token])
      return new Response(JSON.stringify({ client_id: 'CH123', expires_in: 100 }));
    return new Response('bad', { status: 400 });
  }
  if (url.startsWith('https://api.line.me/v2/profile')) {
    const token = (init.headers.authorization || '').replace('Bearer ', '');
    if (VALID_TOKENS[token]) return new Response(JSON.stringify(VALID_TOKENS[token]));
    return new Response('bad', { status: 401 });
  }
  return realFetch(input, init);
};

// ---------- 測試環境 ----------
const db = new DatabaseSync(':memory:');
db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
const env = {
  DB: makeD1(db),
  ADMIN_TOKEN: 'secret-admin',
  LINE_LIFF_ID: '123-abc',
  LINE_LOGIN_CHANNEL_ID: 'CH123',
  COMPANY_NAME: '測試公司',
  ASSETS: { fetch: () => new Response('static') },
};

let passed = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) passed++;
  else failures.push(name + (extra ? ' :: ' + JSON.stringify(extra) : ''));
}
const req = (path, { method = 'GET', body, headers = {} } = {}) =>
  handleRequest(
    new Request('https://clock.test' + path, {
      method,
      headers: body ? { 'content-type': 'application/json', ...headers } : headers,
      body: body ? JSON.stringify(body) : undefined,
    }),
    env
  );
const admin = { authorization: 'Bearer secret-admin' };

// ---------- 單元：純函式 ----------
{
  const p = taipeiParts(new Date('2026-01-15T16:30:00Z')); // UTC+8 → 隔日 00:30
  check('taipeiParts 跨日', p.date === '2026-01-16' && p.time === '00:30:00', p);
  check('isValidMonth', isValidMonth('2026-02') && !isValidMonth('2026-13') && !isValidMonth('x'));
  const d = distanceMeters(25.0330, 121.5654, 25.0330, 121.5754); // 約 1 公里
  check('distanceMeters 約1000m', d > 950 && d < 1100, d);
  const days = computeDailySummary([
    { local_date: '2026-02-02', local_time: '09:00:00', type: 'in', punched_at: '2026-02-02T01:00:00Z', source: 'liff' },
    { local_date: '2026-02-02', local_time: '12:00:00', type: 'break_start', punched_at: '2026-02-02T04:00:00Z', source: 'liff' },
    { local_date: '2026-02-02', local_time: '13:00:00', type: 'break_end', punched_at: '2026-02-02T05:00:00Z', source: 'liff' },
    { local_date: '2026-02-02', local_time: '18:02:00', type: 'out', punched_at: '2026-02-02T10:02:00Z', source: 'amendment' },
  ]);
  check('日摘要工時 9:00-18:02 扣午休60 = 482分',
    days[0].workMinutes === 482 && days[0].breakMinutes === 60 && days[0].hasAmendment, days[0]);
}

// ---------- 整合流程 ----------
const run = async () => {
  // 未授權管理端
  check('管理端無 token 擋下', (await req('/api/admin/employees')).status === 401);

  // 建立員工
  let r = await req('/api/admin/employees', { method: 'POST', headers: admin,
    body: { emp_no: 'E001', name: '艾美' } });
  const amy = await r.json();
  check('新增員工回傳綁定代碼', r.status === 200 && /^[A-Z2-9]{6}$/.test(amy.bind_code), amy);
  r = await req('/api/admin/employees', { method: 'POST', headers: admin,
    body: { emp_no: 'E001', name: '重複' } });
  check('員工編號重複回 409', r.status === 409);

  // 綁定
  r = await req('/api/bind', { method: 'POST',
    body: { accessToken: 'token-amy', bindCode: amy.bind_code } });
  check('員工綁定成功', r.status === 200);
  r = await req('/api/bind', { method: 'POST',
    body: { accessToken: 'token-bob', bindCode: amy.bind_code } });
  check('用過的綁定代碼失效', r.status === 404);
  r = await req('/api/bind', { method: 'POST',
    body: { accessToken: 'fake-token', bindCode: 'XXXXXX' } });
  check('偽造 access token 擋下', r.status === 401);

  // whoami
  r = await req('/api/me', { headers: { 'x-line-access-token': 'token-amy' } });
  check('whoami 已綁定', (await r.json()).bound === true);
  r = await req('/api/me', { headers: { 'x-line-access-token': 'token-bob' } });
  check('whoami 未綁定', (await r.json()).bound === false);

  // 設定地理圍欄（台北 101，半徑 200m）
  r = await req('/api/admin/settings', { method: 'PUT', headers: admin,
    body: { geofence: { name: '公司', lat: 25.0339, lng: 121.5645, radius_m: 200 } } });
  check('設定圍欄', r.status === 200);

  // 打卡：範圍內
  r = await req('/api/punch', { method: 'POST',
    body: { accessToken: 'token-amy', type: 'in', lat: 25.0341, lng: 121.5647, accuracy: 10 } });
  let p = await r.json();
  check('範圍內上班打卡', r.status === 200 && p.inRange === 1 && /^\d\d:\d\d:\d\d$/.test(p.time), p);
  const month = p.date.slice(0, 7);

  // 60 秒內同類別重複打卡
  r = await req('/api/punch', { method: 'POST',
    body: { accessToken: 'token-amy', type: 'in', lat: 25.0341, lng: 121.5647 } });
  check('重複打卡擋下', r.status === 429);

  // 範圍外（約 1.1 公里外）仍成功但標記
  r = await req('/api/punch', { method: 'POST',
    body: { accessToken: 'token-amy', type: 'out', lat: 25.0430, lng: 121.5645, accuracy: 8 } });
  p = await r.json();
  check('範圍外打卡成功且標記', r.status === 200 && p.inRange === 0, p);

  // 無定位也可打卡
  r = await req('/api/punch', { method: 'POST',
    body: { accessToken: 'token-amy', type: 'break_start' } });
  check('無定位打卡', r.status === 200 && (await r.json()).inRange === null);

  // 未綁定者不能打卡
  r = await req('/api/punch', { method: 'POST',
    body: { accessToken: 'token-bob', type: 'in' } });
  check('未綁定不能打卡', r.status === 403);

  // 個人紀錄與副本下載
  r = await req('/api/me/records?month=' + month,
    { headers: { 'x-line-access-token': 'token-amy' } });
  let recs = await r.json();
  check('個人紀錄 3 筆', recs.punches.length === 3, recs.punches.length);
  r = await req('/api/me/export?month=' + month,
    { headers: { 'x-line-access-token': 'token-amy' } });
  const csvBytes = new Uint8Array(await r.arrayBuffer());
  const csv = new TextDecoder().decode(csvBytes);
  check('個人 CSV 含 BOM 與姓名',
    csvBytes[0] === 0xef && csvBytes[1] === 0xbb && csvBytes[2] === 0xbf && csv.includes('艾美'));

  // 每月確認
  r = await req('/api/me/confirm', { method: 'POST',
    body: { accessToken: 'token-amy', month } });
  check('每月確認', r.status === 200);
  r = await req('/api/admin/confirmations?month=' + month, { headers: admin });
  check('管理端看到確認', (await r.json()).confirmations.length === 1);

  // 補登：無事由擋下、未來時間擋下、正常補登
  r = await req('/api/admin/punches', { method: 'POST', headers: admin,
    body: { employee_id: 1, type: 'out', punched_at: '2026-01-05T10:00:00Z', reason: '' } });
  check('補登無事由擋下', r.status === 400);
  r = await req('/api/admin/punches', { method: 'POST', headers: admin,
    body: { employee_id: 1, type: 'out', punched_at: '2999-01-05T10:00:00Z', reason: 'x' } });
  check('補登未來時間擋下', r.status === 400);
  r = await req('/api/admin/punches', { method: 'POST', headers: admin,
    body: { employee_id: 1, type: 'break_end', punched_at: new Date(Date.now() - 3600e3).toISOString(), reason: '忘打卡' } });
  const amendRes = await r.json();
  check('補登成功', r.status === 200 && amendRes.id > 0, amendRes);

  // 作廢：需事由、原始資料保留
  r = await req(`/api/admin/punches/${amendRes.id}/void`, { method: 'POST', headers: admin,
    body: { reason: '登錯時間' } });
  check('作廢成功', r.status === 200);
  r = await req(`/api/admin/punches/${amendRes.id}/void`, { method: 'POST', headers: admin,
    body: { reason: '再一次' } });
  check('重複作廢擋下', r.status === 409);
  const voidedRow = db.prepare('SELECT * FROM punches WHERE id = ?').get(amendRes.id);
  check('作廢後原始時間仍在', voidedRow.voided === 1 && voidedRow.punched_at !== null
    && voidedRow.local_time !== null, voidedRow);

  // 月報 CSV / 書面報表
  r = await req('/api/admin/export?month=' + month, { headers: admin });
  const monthCsv = await r.text();
  check('月報含逐日欄位', monthCsv.includes('日期') && monthCsv.includes('E001'));
  r = await req('/api/admin/report?month=' + month, { headers: admin });
  const html = await r.text();
  check('書面報表含法規說明與簽名欄', html.includes('勞動基準法第30條')
    && html.includes('勞工簽名') && html.includes('艾美'));

  // 出勤查詢包含作廢紀錄（透明呈現）
  r = await req('/api/admin/punches?month=' + month, { headers: admin });
  const allP = await r.json();
  check('管理端看得到作廢紀錄', allP.punches.some((x) => x.voided === 1));

  // 稽核軌跡
  r = await req('/api/admin/audit', { headers: admin });
  const audit = await r.json();
  const actions = audit.audit.map((a) => a.action);
  check('稽核軌跡完整', ['create_employee', 'bind', 'confirm_month', 'amend_punch', 'void_punch', 'set_geofence']
    .every((a) => actions.includes(a)), actions);

  // 重新綁定流程
  r = await req('/api/admin/employees/1', { method: 'PATCH', headers: admin,
    body: { action: 'rebind' } });
  const rb = await r.json();
  check('重新綁定產生新代碼', /^[A-Z2-9]{6}$/.test(rb.bind_code));
  r = await req('/api/bind', { method: 'POST',
    body: { accessToken: 'token-bob', bindCode: rb.bind_code } });
  check('新代碼可由新帳號綁定', r.status === 200);

  // config 與靜態頁
  r = await req('/api/config');
  check('config 公開', (await r.json()).liffId === '123-abc');
  r = await req('/');
  check('靜態頁 fallback', (await r.text()) === 'static');

  // 結果
  console.log(`\n通過 ${passed} 項檢查`);
  if (failures.length) {
    console.error(`失敗 ${failures.length} 項：`);
    for (const f of failures) console.error('  ✗ ' + f);
    process.exit(1);
  }
  console.log('全部通過 ✅');
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
