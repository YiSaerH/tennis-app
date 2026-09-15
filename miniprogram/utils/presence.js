/* 球友地图的在线状态（云函数通道）+ 演示兜底：
   - report / checkin / offline：把「假名 + 网格点」写入云端 presence 集合。
     openid 在云函数里经 HMAC 哈希成假名，数据库里不存任何明文身份。
   - density：拉取地图中心附近的聚合网格点（只给格中心 + 人数）。
   - 未开通云开发（或调用失败）时降级为演示数据，球友页在开发者工具里开箱即用。 */

var geogrid = require('./geogrid');

var HEARTBEAT_MS = 5 * 60 * 1000;  // 前端每 5 分钟上报一次
var HEARTBEAT_TTL = 600;           // 云端记录有效期 10 分钟（漏报一两次也不会掉线）
var CHECKIN_TTL = 2 * 60 * 60;     // 球场打卡保留 2 小时

var cloudReady = false;

/* app.js 里启动时调用一次；没开通云开发时返回 false，业务走演示数据 */
function initCloud() {
  if (!wx.cloud) return false;
  try {
    wx.cloud.init({ traceUser: false });
    cloudReady = true;
  } catch (e) {
    cloudReady = false;
  }
  return cloudReady;
}

function callFn(name, data, cb) {
  if (!cloudReady) { cb(new Error('云开发未初始化')); return; }
  wx.cloud.callFunction({
    name: name,
    data: data,
    success(res) { cb(null, res.result); },
    fail(res) { cb(res); }
  });
}

/* 上报一次位置（ttl 秒）。演示模式（无云）直接当成功，打卡等流程可测 */
function report(lat, lng, ttl, cb) {
  callFn('report', { grid: geogrid.gridKey(lat, lng), ttl: ttl }, function (err) {
    if (cb) cb(err || null);
  });
}

/* 球场打卡：在地图上亮 2 小时 */
function checkin(lat, lng, cb) {
  report(lat, lng, CHECKIN_TTL, cb);
}

/* 主动下线：立刻删掉自己的在线记录 */
function offline(cb) {
  callFn('report', { ttl: 0 }, function (err) {
    if (cb) cb(err || null);
  });
}

/* 附近密度。拿不到云数据 → 演示网格（demo 标记给页面显示提示条） */
function density(lat, lng, cb) {
  callFn('density', { lat: lat, lng: lng }, function (err, result) {
    if (err || !result || !result.cells) {
      cb(null, { demo: true, cells: geogrid.demoCells(lat, lng) });
      return;
    }
    cb(null, { demo: false, cells: result.cells });
  });
}

module.exports = {
  HEARTBEAT_MS: HEARTBEAT_MS,
  HEARTBEAT_TTL: HEARTBEAT_TTL,
  CHECKIN_TTL: CHECKIN_TTL,
  initCloud: initCloud,
  report: report,
  checkin: checkin,
  offline: offline,
  density: density
};
