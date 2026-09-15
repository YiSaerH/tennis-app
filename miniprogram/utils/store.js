/* 数据与业务逻辑，与网页版（localStorage key: tennis_log_v1）完全同构：
   - 数据结构一致，JSON 备份可在网页版与小程序之间互导
   - iOS 的 JavaScriptCore 用 new Date('2026-09-14') 会得到 Invalid Date，
     所有日期一律走 parseDate 手动解析 */

const KEY = 'tennis_log_v1';

let store = { rackets: [], sessions: [], opponents: [] };

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
  if (!store.opponents) store.opponents = [];
  /* 一次性迁移：老数据没有对手库，把历史记录里的对手收进来。
     只在首次运行时做，之后用户从候选名单里删掉的对手不会复活 */
  if (!store.opponentsMigrated) {
    store.sessions.forEach(function (s) {
      const o = (s.opponent || '').trim();
      if (o && store.opponents.indexOf(o) < 0) store.opponents.push(o);
    });
    store.opponentsMigrated = true;
    save();
  }
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
  /* 保存时对手自动进候选名单（从名单里删掉的，再保存一次也会回来） */
  const opp = (obj.opponent || '').trim();
  if (opp && store.opponents.indexOf(opp) < 0) store.opponents.push(opp);
  const i = store.sessions.findIndex(function (x) { return x.id === obj.id; });
  if (i >= 0) store.sessions[i] = obj; else store.sessions.push(obj);
  save();
  return obj;
}
function deleteSession(id) {
  store.sessions = store.sessions.filter(function (x) { return x.id !== id; });
  save();
}
/* 从「和谁打」候选名单里移除：只影响候选，历史记录不动 */
function deleteOpponent(name) {
  store.opponents = store.opponents.filter(function (o) { return o !== name; });
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
/* 金额去掉多余的尾零：40 → ¥40，33.5 → ¥33.5 */
function fmtMoney(v) {
  return '¥' + String(+(+v || 0).toFixed(2));
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
/* month = 'YYYY-MM'（默认本月），统计页按月翻看历史 */
function computeStats(month) {
  const ss = store.sessions;
  const totalMin = ss.reduce(function (a, s) { return a + (+s.duration || 0); }, 0);
  const totalCost = ss.reduce(function (a, s) { return a + (+s.cost || 0); }, 0);
  const m = month || currentMonth();
  const monthArr = ss.filter(function (s) { return (s.date || '').slice(0, 7) === m; });
  const monthMin = monthArr.reduce(function (a, s) { return a + (+s.duration || 0); }, 0);
  const monthCost = monthArr.reduce(function (a, s) { return a + (+s.cost || 0); }, 0);

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
    totalCost: totalCost,
    month: m,
    monthCount: monthArr.length,
    monthMin: monthMin,
    monthCost: monthCost,
    oppArr: oppArr,
    maxOpp: maxOpp,
    recent: recent
  };
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
  const oldSessionIds = {};   // 导入前就有的记录：这些记录的对手不再进候选名单（防复活已删的）
  store.sessions.forEach(function (s) { existingS[s.id] = s; oldSessionIds[s.id] = true; });
  (data.rackets || []).forEach(function (r) { if (r.id) existingR[r.id] = r; });
  (data.sessions || []).forEach(function (s) { if (s.id) existingS[s.id] = s; });
  store.rackets = Object.keys(existingR).map(function (k) { return existingR[k]; });
  store.sessions = Object.keys(existingS).map(function (k) { return existingS[k]; });
  /* 对手库合并：备份里显式保存的 + 备份新增记录里的 */
  const seenOpp = {};
  store.opponents.forEach(function (o) { seenOpp[o] = true; });
  function addOpp(k) {
    k = String(k || '').trim();
    if (k && !seenOpp[k]) { seenOpp[k] = true; store.opponents.push(k); }
  }
  (data.opponents || []).forEach(addOpp);
  (data.sessions || []).forEach(function (s) {
    if (s.id && !oldSessionIds[s.id]) addOpp(s.opponent);
  });
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
  deleteOpponent: deleteOpponent,
  parseDate: parseDate,
  fmtDate: fmtDate,
  fmtDuration: fmtDuration,
  fmtHours: fmtHours,
  fmtMoney: fmtMoney,
  todayStr: todayStr,
  currentMonth: currentMonth,
  racketName: racketName,
  stringingInfo: stringingInfo,
  buildCalendar: buildCalendar,
  shiftMonth: shiftMonth,
  computeStats: computeStats,
  exportData: exportData,
  importData: importData
};
