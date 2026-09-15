/* 小程序核心逻辑自测：node test-store.js
   在 Node 里 mock 掉 wx 存储接口，直接跑 miniprogram/utils/store.js 的逻辑。 */
const path = require('path');

/* ---- mock wx 存储 ---- */
const mem = {};
global.wx = {
  getStorageSync: function (k) { return k in mem ? mem[k] : ''; },
  setStorageSync: function (k, v) { mem[k] = v; }
};

const STORE_PATH = path.join(__dirname, 'miniprogram', 'utils', 'store.js');
/* 每组用例用全新实例，互不污染 */
function fresh() {
  Object.keys(mem).forEach(function (k) { delete mem[k]; });
  delete require.cache[require.resolve(STORE_PATH)];
  return require(STORE_PATH);
}

let passed = 0, failed = 0;
function ok(cond, msg) {
  if (cond) { passed++; console.log('  ✓ ' + msg); }
  else { failed++; console.log('  ✗ ' + msg); }
}
function eq(a, b, msg) {
  ok(JSON.stringify(a) === JSON.stringify(b),
    msg + ' → 得到 ' + JSON.stringify(a) + '，期望 ' + JSON.stringify(b));
}
function daysAgoStr(n) {
  const d = new Date(Date.now() - n * 86400000);
  const p = function (x) { return x < 10 ? '0' + x : '' + x; };
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

/* ---- 1. 空库加载 ---- */
console.log('\n[1] 空库加载');
{
  const s = fresh();
  s.load();
  eq(s.getStore().rackets, [], 'rackets 为空数组');
  eq(s.getStore().sessions, [], 'sessions 为空数组');
}

/* ---- 2. 纯函数：日期与格式化 ---- */
console.log('\n[2] 日期与格式化');
{
  const s = fresh();
  const d = s.parseDate('2026-09-14');
  ok(d && d.getTime() === new Date(2026, 8, 14).getTime(), "parseDate('2026-09-14') 与 new Date(2026,8,14) 一致（iOS 安全）");
  const d2 = s.parseDate('2026-9-4');
  ok(d2 && d2.getTime() === new Date(2026, 8, 4).getTime(), "parseDate('2026-9-4') 容忍不带前导零");
  ok(s.parseDate('垃圾') === null, "parseDate('垃圾') → null");
  eq(s.fmtDuration(90), '1小时30分', 'fmtDuration(90)');
  eq(s.fmtDuration(60), '1小时', 'fmtDuration(60)');
  eq(s.fmtDuration(45), '45分钟', 'fmtDuration(45)');
  eq(s.fmtDuration(0), '—', 'fmtDuration(0)');
  eq(s.fmtHours(45), { n: '45', unit: '分钟' }, 'fmtHours(45) 按分钟');
  eq(s.fmtHours(90), { n: '1.5', unit: '小时' }, 'fmtHours(90)');
  eq(s.fmtHours(60), { n: '1', unit: '小时' }, 'fmtHours(60) 去掉 .0');
  eq(s.fmtDate('2026-09-14'), '2026年9月14日 周一', 'fmtDate 中文星期');
  eq(s.shiftMonth('2026-01', -1), '2025-12', 'shiftMonth 跨年');
  eq(s.shiftMonth('2026-12', 1), '2027-01', 'shiftMonth 跨年（加）');
}

/* ---- 3. 穿线提醒边界 ---- */
console.log('\n[3] 穿线提醒（45 天 或 15 小时）');
{
  const s = fresh();
  s.load();
  const r = s.upsertRacket({ name: '测试拍', strung: daysAgoStr(50) });
  const info = s.stringingInfo(r);
  ok(info.due === true, '50 天没打线也到期限（days>=45）→ 建议换线');
  ok(info.days >= 50 && info.days <= 51, '天数计算合理（' + info.days + ' 天）');

  s.deleteRacket(r.id);
  const r2 = s.upsertRacket({ name: '新线拍', strung: daysAgoStr(3) });
  s.upsertSession({ date: daysAgoStr(2), opponent: 'A', duration: 120, racketId: r2.id });
  s.upsertSession({ date: daysAgoStr(1), opponent: 'B', duration: 840, racketId: r2.id });
  const info2 = s.stringingInfo(r2);
  ok(info2.due === true, '3 天内打了 16 小时（>=15h）→ 建议换线');
  eq(info2.hours, 16, '小时数只统计穿线之后的记录');

  s.deleteRacket(r2.id);
  const r3 = s.upsertRacket({ name: '正常拍', strung: daysAgoStr(10) });
  s.upsertSession({ date: daysAgoStr(20), opponent: '旧记录', duration: 600, racketId: r3.id }); // 穿线之前，应排除
  s.upsertSession({ date: daysAgoStr(5), opponent: '新记录', duration: 300, racketId: r3.id });
  const info3 = s.stringingInfo(r3);
  ok(info3.due === false, '10 天 + 5 小时 → 不提醒');
  eq(info3.hours, 5, '穿线前的记录不计入小时数');

  s.restringRacket(r3.id);
  const info4 = s.stringingInfo(s.getStore().rackets[0]);
  ok(info4.days <= 1 && info4.hours === 0, '记录换线后重新计时');
  ok(s.stringingInfo({ name: '无日期' }) === null, '没有穿线日期 → 不提醒');
}

/* ---- 4. 月历 ---- */
console.log('\n[4] 月历（2026-09：9月1日是周二）');
{
  const s = fresh();
  s.load();
  s.upsertSession({ date: '2026-09-14', opponent: '小王', duration: 90 });
  s.upsertSession({ date: '2026-09-14', opponent: '小李', duration: 60 });
  s.upsertSession({ date: '2026-08-20', opponent: '上月', duration: 60 });
  const cal = s.buildCalendar('2026-09');
  eq(cal.cells.length, 35, '2 前置 + 30 天 + 3 后置 = 35 格');
  ok(cal.cells.filter(function (c) { return c.blank; }).length === 5, '空格数 5（2 前 + 3 后）');
  const first = cal.cells[2];
  eq([first.d, first.ds], [1, '2026-09-01'], '第一格是 9 月 1 日');
  const day14 = cal.cells[2 + 13];
  ok(day14.has === true && day14.n === 2, '9 月 14 日标记有球且计数 2');
  const day20 = cal.cells.filter(function (c) { return c.ds === '2026-09-20'; })[0];
  ok(day20.has === false, '上月的记录不影响本月标记');
  const sel = s.buildCalendar('2026-09', '2026-09-14').cells[15];
  ok(sel.sel === true, '选中日标记');
}

/* ---- 5. 统计 ---- */
console.log('\n[5] 统计');
{
  const s = fresh();
  s.load();
  const today = s.todayStr();
  s.upsertSession({ date: today, opponent: '小王', duration: 90 });
  s.upsertSession({ date: today, opponent: '小王', duration: 60 });
  s.upsertSession({ date: today, opponent: '小李', duration: 30 });
  s.upsertSession({ date: '2020-01-05', opponent: '老张', duration: 120 });
  const st = s.computeStats();
  eq(st.total, 4, '总次数');
  eq(st.totalMin, 300, '总分钟');
  eq(st.monthCount, 3, '本月次数（只算本月）');
  eq(st.monthMin, 180, '本月分钟');
  eq(st.oppArr[0], ['小王', 2], '对手排行第一名');
  ok(st.maxOpp === 2, 'maxOpp');
  eq(st.recent[0].date, today, '最近一条是今天');
  ok(st.recent.length === 4, 'recent 最多 10 条');
}

/* ---- 6. 增删改 + 持久化 ---- */
console.log('\n[6] 增删改与持久化');
{
  const s = fresh();
  s.load();
  const r = s.upsertRacket({ name: '拍A' });
  const ses = s.upsertSession({ date: '2026-09-14', opponent: '小王', duration: 90, racketId: r.id });
  const created = ses.createdAt;
  ok(!!r.id && !!ses.id, '自动生成 id');
  eq(s.racketName(r.id), '拍A', 'racketName 查名');

  // 编辑保留 createdAt
  s.upsertSession({ id: ses.id, date: '2026-09-15', opponent: '小王', duration: 100, racketId: r.id, createdAt: created });
  const after = s.getStore().sessions[0];
  ok(after.createdAt === created && after.duration === 100, '编辑同 id 覆盖且保留 createdAt');

  // 删除
  s.deleteSession(ses.id);
  eq(s.getStore().sessions.length, 0, '删除记录');
  s.deleteRacket(r.id);
  eq(s.getStore().rackets.length, 0, '删除拍子');

  // 重启（重新 require + load）后数据还在：不清 mem，只重载模块
  s.upsertRacket({ name: '重启测试' });
  delete require.cache[require.resolve(STORE_PATH)];
  const s2 = require(STORE_PATH);
  s2.load();
  eq(s2.getStore().rackets[0].name, '重启测试', '重启后数据仍在（setStorageSync 生效）');
}

/* ---- 7. 导出 / 导入（与网页版 JSON 互通） ---- */
console.log('\n[7] 导出 / 导入');
{
  const s = fresh();
  s.load();
  const r1 = s.upsertRacket({ name: '拍A' });
  s.upsertSession({ date: '2026-09-14', opponent: '小王', duration: 90, racketId: r1.id });

  const json = s.exportData();
  const parsed = JSON.parse(json);
  ok(Array.isArray(parsed.rackets) && Array.isArray(parsed.sessions) && !!parsed.exportedAt,
    '导出 JSON 结构 = {rackets, sessions, exportedAt}（网页版同构）');

  // 空库导入这份备份 → 数据一致
  Object.keys(mem).forEach(function (k) { delete mem[k]; });
  delete require.cache[require.resolve(STORE_PATH)];
  const s2 = require(STORE_PATH);
  s2.load();
  s2.importData(json);
  eq(s2.getStore().rackets[0].name, '拍A', '空库导入备份');

  // 合并导入：同 id 以备份为准，新 id 追加
  const backup = JSON.stringify({
    rackets: [
      { id: r1.id, name: '拍A-改名', createdAt: 1 },
      { id: 'r_new', name: '备份里的新拍', createdAt: 2 }
    ],
    sessions: [
      { id: 's_new', date: '2026-01-01', opponent: '备份新增', duration: 60, createdAt: 3 }
    ]
  });
  s2.importData(backup);
  const st = s2.getStore();
  eq(st.rackets.length, 2, '合并后拍子 2 把');
  eq(st.rackets[0].name, '拍A-改名', '同 id 以备份为准');
  eq(st.sessions.length, 2, '合并后记录 2 条');

  // 坏数据
  let threw = false;
  try { s2.importData('{"foo":1}'); } catch (e) { threw = true; }
  ok(threw, '缺 rackets/sessions 的 JSON 抛错');
  threw = false;
  try { s2.importData('不是json'); } catch (e) { threw = true; }
  ok(threw, '非法 JSON 抛错');
}

/* ---- 8. 设置（饰品 / 球友共享） ---- */
console.log('\n[8] 设置（饰品 / 球友共享）');
{
  const s = fresh();
  s.load();
  const def = s.defaultSettings();
  eq(def.shareLocation, false, '默认不共享位置（隐私默认关）');
  eq(def.lostAlert, true, '默认开防丢提醒');
  eq(def.lightMode, 2, '默认呼吸灯');
  eq(def.color, '#ccff00', '默认网球黄绿');

  eq(s.getSettings().charmName, '', '空库 getSettings 走默认值');
  s.updateSettings({ charmName: '小绿', brightness: 180 });
  eq(s.getSettings().charmName, '小绿', 'updateSettings 写入昵称');
  eq(s.getSettings().brightness, 180, 'updateSettings 写入亮度');
  eq(s.getSettings().lostAlert, true, '没动过的字段保持默认');

  // 老数据（无 settings 字段）升级：load 时补默认值
  mem[require(path.join(__dirname, 'miniprogram', 'utils', 'store.js')).KEY] = {
    rackets: [], sessions: []
  };
  delete require.cache[require.resolve(STORE_PATH)];
  const s2 = require(STORE_PATH);
  s2.load();
  eq(s2.getSettings().shareLocation, false, '老备份无 settings → load 补默认值');

  // 设置随备份导出
  const parsed = JSON.parse(s2.exportData());
  ok(parsed.settings && parsed.settings.lightMode === 2, 'settings 随 exportData 导出');
}

console.log('\n结果：' + passed + ' 通过，' + failed + ' 失败');
process.exit(failed ? 1 : 0);
