/* 数据与业务逻辑，与网页版（localStorage key: tennis_log_v1）完全同构：
   - 数据结构一致，JSON 备份可在网页版与小程序之间互导
   - iOS 的 JavaScriptCore 用 new Date('2026-09-14') 会得到 Invalid Date，
     所有日期一律走 parseDate 手动解析 */

const KEY = 'tennis_log_v1';

let store = { rackets: [], sessions: [], settings: defaultSettings() };

/* ---------- 存储 ---------- */
function load() {
  try {
    const raw = wx.getStorageSync(KEY);
    if (raw) store = (typeof raw === 'string') ? JSON.parse(raw) : raw;
  } catch (e) {
    console.warn('读取失败', e);
  }
  if (!store.rackets) store.rackets = [];
  if (!store.sessions) store.sessions = [];
  /* 老数据没有 settings / 新版本加了字段，都补默认值 */
  store.settings = Object.assign(defaultSettings(), store.settings || {});
  return store;
}
function save() {
  wx.setStorageSync(KEY, store);
}
function getStore() {
  return store;
}

/* ---------- 增删改 ---------- */
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}
function upsertSession(obj) {
  if (!obj.id) obj.id = uid();
  if (!obj.createdAt) obj.createdAt = Date.now();
  const i = store.sessions.findIndex(function (x) { return x.id === obj.id; });
  if (i >= 0) store.sessions[i] = obj; else store.sessions.push(obj);
  save();
  return obj;
}
function deleteSession(id) {
  store.sessions = store.sessions.filter(function (x) { return x.id !== id; });
  save();
}
function upsertRacket(obj) {
  if (!obj.id) obj.id = uid();
  if (!obj.createdAt) obj.createdAt = Date.now();
  const i = store.rackets.findIndex(function (x) { return x.id === obj.id; });
  if (i >= 0) store.rackets[i] = obj; else store.rackets.push(obj);
  save();
  return obj;
}
function deleteRacket(id) {
  store.rackets = store.rackets.filter(function (x) { return x.id !== id; });
  save();
}
/* 换线：把穿线日期记为今天，重新开始计时 */
function restringRacket(id) {
  const r = store.rackets.find(function (x) { return x.id === id; });
  if (!r) return null;
  r.strung = todayStr();
  save();
  return r;
}

/* ---------- 工具 ---------- */
function pad2(n) {
  return n < 10 ? '0' + n : '' + n;
}
function parseDate(s) {
  if (!s) return null;
  const p = String(s).split('-').map(Number);
  if (p.length >= 3 && p[0] > 0 && p[1] > 0 && p[2] > 0) {
    return new Date(p[0], p[1] - 1, p[2]);
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}
const WD = ['日', '一', '二', '三', '四', '五', '六'];
function fmtDate(d) {
  const dt = parseDate(d);
  if (!dt) return d || '';
  return dt.getFullYear() + '年' + (dt.getMonth() + 1) + '月' + dt.getDate() + '日 周' + WD[dt.getDay()];
}
function fmtDuration(min) {
  if (!min) return '—';
  const h = Math.floor(min / 60), m = min % 60;
  if (h && m) return h + '小时' + m + '分';
  if (h) return h + '小时';
  return m + '分钟';
}
/* 不足 1 小时按分钟显示，避免 1 分钟被四舍五入成 "0.0小时" 看起来像没记上 */
function fmtHours(min) {
  if (min < 60) return { n: String(min), unit: '分钟' };
  return { n: (min / 60).toFixed(1).replace(/\.0$/, ''), unit: '小时' };
}
function todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}
function currentMonth() {
  return todayStr().slice(0, 7);
}
function racketName(id) {
  const r = store.rackets.find(function (x) { return x.id === id; });
  return r ? r.name : '';
}

/* ---------- 穿线提醒：已穿超过 45 天 或 累计打球超过 15 小时 → 建议换线 ---------- */
function stringingInfo(r) {
  if (!r.strung) return null;
  const d = parseDate(r.strung);
  if (!d) return null;
  const days = Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000));
  const ss = store.sessions.filter(function (s) {
    return s.racketId === r.id && s.date && s.date >= r.strung;
  });
  const hours = ss.reduce(function (a, s) { return a + (+s.duration || 0); }, 0) / 60;
  return { days: days, hours: +hours.toFixed(1), due: days >= 45 || hours >= 15 };
}

/* ---------- 月历：哪些天打了球 ---------- */
function buildCalendar(month, selDay) {
  const parts = String(month || currentMonth()).split('-').map(Number);
  const y = parts[0], mo = parts[1];
  if (!y || !mo) return null;
  const startWd = new Date(y, mo - 1, 1).getDay(); // 0=周日
  const daysIn = new Date(y, mo, 0).getDate();
  const today = todayStr();
  const byDate = {};
  store.sessions.forEach(function (s) {
    if (s.date) byDate[s.date] = (byDate[s.date] || 0) + 1;
  });
  const cells = [];
  let k = 0;
  function push(o) {
    o.k = k++;
    cells.push(o);
  }
  for (let i = 0; i < startWd; i++) push({ blank: true });
  for (let d = 1; d <= daysIn; d++) {
    const ds = y + '-' + pad2(mo) + '-' + pad2(d);
    const n = byDate[ds] || 0;
    push({ d: d, ds: ds, n: n, has: n > 0, today: ds === today, sel: selDay === ds });
  }
  const trailing = (7 - (startWd + daysIn) % 7) % 7;
  for (let i = 0; i < trailing; i++) push({ blank: true });
  return { y: y, mo: mo, cells: cells };
}
function shiftMonth(month, delta) {
  const p = String(month).split('-').map(Number);
  const d = new Date(p[0], p[1] - 1 + delta, 1);
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1);
}

/* ---------- 统计 ---------- */
function computeStats() {
  const ss = store.sessions;
  const totalMin = ss.reduce(function (a, s) { return a + (+s.duration || 0); }, 0);
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const thisMonth = ss.filter(function (s) {
    const d = parseDate(s.date);
    return d && d >= monthStart;
  });
  const monthMin = thisMonth.reduce(function (a, s) { return a + (+s.duration || 0); }, 0);

  const opp = {};
  ss.forEach(function (s) {
    const key = s.opponent || '—';
    opp[key] = (opp[key] || 0) + 1;
  });
  const oppArr = Object.keys(opp)
    .map(function (k) { return [k, opp[k]]; })
    .sort(function (a, b) { return b[1] - a[1]; });
  const maxOpp = oppArr.length ? oppArr[0][1] : 1;

  const recent = ss.slice().sort(function (a, b) {
    if ((b.date || '') !== (a.date || '')) return (b.date || '') > (a.date || '') ? 1 : -1;
    return (b.createdAt || 0) - (a.createdAt || 0);
  }).slice(0, 10);

  return {
    total: ss.length,
    totalMin: totalMin,
    monthCount: thisMonth.length,
    monthMin: monthMin,
    oppArr: oppArr,
    maxOpp: maxOpp,
    recent: recent
  };
}

/* ---------- 设置（饰品 / 球友共享；随备份一起导出，网页版会忽略该字段） ---------- */
function defaultSettings() {
  return {
    shareLocation: false,  // 球友地图共享（默认关，开了才上报）
    lastCheckinAt: 0,      // 上次球场打卡时间（打卡在地图上保留 2 小时）
    charmName: '',         // 饰品昵称
    lightMode: 2,          // 灯效模式（与 ble-protocol 的 MODES 对应：0关 1常亮 2呼吸 3心跳 4弹跳 5彩虹 6雷达）
    brightness: 90,        // 亮度 0-255
    color: '#ccff00',      // 灯色（网球黄绿）
    lostAlert: true        // 饰品断连时防丢提醒
  };
}
function updateSettings(patch) {
  store.settings = Object.assign(defaultSettings(), store.settings || {}, patch || {});
  save();
  return store.settings;
}
function getSettings() {
  if (!store.settings) {
    store.settings = defaultSettings();
  }
  return store.settings;
}

/* ---------- 导出 / 导入（与网页版 JSON 互通） ---------- */
function exportData() {
  return JSON.stringify(Object.assign({}, store, { exportedAt: new Date().toISOString() }));
}
/* 按合并导入：同 id 以备份为准 */
function importData(json) {
  const data = JSON.parse(json);
  if (!data.rackets && !data.sessions) throw new Error('格式不对：找不到 rackets / sessions');
  const existingR = {};
  store.rackets.forEach(function (r) { existingR[r.id] = r; });
  const existingS = {};
  store.sessions.forEach(function (s) { existingS[s.id] = s; });
  (data.rackets || []).forEach(function (r) { if (r.id) existingR[r.id] = r; });
  (data.sessions || []).forEach(function (s) { if (s.id) existingS[s.id] = s; });
  store.rackets = Object.keys(existingR).map(function (k) { return existingR[k]; });
  store.sessions = Object.keys(existingS).map(function (k) { return existingS[k]; });
  save();
}

module.exports = {
  KEY: KEY,
  load: load,
  save: save,
  getStore: getStore,
  uid: uid,
  upsertSession: upsertSession,
  deleteSession: deleteSession,
  upsertRacket: upsertRacket,
  deleteRacket: deleteRacket,
  restringRacket: restringRacket,
  parseDate: parseDate,
  fmtDate: fmtDate,
  fmtDuration: fmtDuration,
  fmtHours: fmtHours,
  todayStr: todayStr,
  currentMonth: currentMonth,
  racketName: racketName,
  stringingInfo: stringingInfo,
  defaultSettings: defaultSettings,
  updateSettings: updateSettings,
  getSettings: getSettings,
  buildCalendar: buildCalendar,
  shiftMonth: shiftMonth,
  computeStats: computeStats,
  exportData: exportData,
  importData: importData
};
