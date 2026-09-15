/* 网格地理编码：把经纬度吸附到 0.01°（约 1.1km）网格上，用于球友地图的聚合与匿名化。
   纯逻辑模块（不依赖 wx），node test-geogrid.js 可直接跑。
   隐私原则：任何上报只传网格点（格中心）+ 人数，个人精确位置永不出设备 */

var GRID_STEP = 0.01;

/* lat/lng → 网格 key "39.90,116.41"（负数经纬度同样适用） */
function gridKey(lat, lng) {
  var a = Math.round(lat / GRID_STEP) * GRID_STEP;
  var b = Math.round(lng / GRID_STEP) * GRID_STEP;
  return a.toFixed(2) + ',' + b.toFixed(2);
}

/* 网格 key → 格中心坐标（喂给地图组件 / 密度圆圈） */
function gridCenter(key) {
  var p = String(key).split(',').map(Number);
  return { latitude: p[0], longitude: p[1] };
}

/* 人数 → 热力色：绿（1人）→ 橙（2-3）→ 红（4+） */
function densityColor(count) {
  if (count >= 4) return '#e53935';
  if (count >= 2) return '#f57c00';
  return '#66bb6a';
}

/* 人数 → 圆圈半径（米）：人越多圈越大，封顶 800 */
function circleRadius(count) {
  return Math.min(800, 400 + count * 100);
}

/* 云函数返回的网格点数组 → 地图组件的 circles（描边 + 半透明填充） */
function buildCircles(cells) {
  return (cells || []).map(function (c) {
    var center = gridCenter(c.grid);
    var color = densityColor(c.count);
    return {
      latitude: center.latitude,
      longitude: center.longitude,
      radius: circleRadius(c.count),
      color: color + 'cc',
      fillColor: color + '55',
      strokeWidth: 2
    };
  });
}

/* 演示数据：中心点周围撒几个网格，没开通云开发时地图也有东西可看（devtools 里直接生效）。
   偏移量都是 0.01 的整倍数，保证落在确定的相邻格上 */
function demoCells(lat, lng) {
  var spec = [
    { dLat: 0.02, dLng: -0.01, count: 1 },
    { dLat: -0.03, dLng: 0.02, count: 2 },
    { dLat: 0.05, dLng: 0.05, count: 1 },
    { dLat: -0.01, dLng: -0.04, count: 4 },
    { dLat: 0.07, dLng: -0.03, count: 2 }
  ];
  return spec.map(function (s) {
    return { grid: gridKey(lat + s.dLat, lng + s.dLng), count: s.count };
  });
}

module.exports = {
  GRID_STEP: GRID_STEP,
  gridKey: gridKey,
  gridCenter: gridCenter,
  densityColor: densityColor,
  circleRadius: circleRadius,
  buildCircles: buildCircles,
  demoCells: demoCells
};
