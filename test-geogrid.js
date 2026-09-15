/* 球友地图网格逻辑自测：node test-geogrid.js
   miniprogram/utils/geogrid.js 是纯逻辑模块（不依赖 wx），直接跑。 */
const path = require('path');

const G = require(path.join(__dirname, 'miniprogram', 'utils', 'geogrid.js'));

let passed = 0, failed = 0;
function ok(cond, msg) {
  if (cond) { passed++; console.log('  ✓ ' + msg); }
  else { failed++; console.log('  ✗ ' + msg); }
}
function eq(a, b, msg) {
  ok(JSON.stringify(a) === JSON.stringify(b),
    msg + ' → 得到 ' + JSON.stringify(a) + '，期望 ' + JSON.stringify(b));
}

/* ---- 1. 网格吸附 ---- */
console.log('\n[1] 网格吸附（0.01° ≈ 1.1km）');
{
  eq(G.gridKey(39.904, 116.407), '39.90,116.41', '北京一带：四舍五入到 2 位小数');
  eq(G.gridKey(-33.916, 151.229), '-33.92,151.23', '南半球/悉尼：负数同样适用');
  eq(G.gridKey(39.906, 116.406), G.gridKey(39.914, 116.414), '同一格内的不同坐标 → 同一个 key（匿名化的关键）');
  ok(G.gridKey(39.905, 116.415) !== G.gridKey(39.915, 116.415), '跨格 → 不同 key');
  eq(G.gridCenter('39.90,116.41'), { latitude: 39.90, longitude: 116.41 }, 'gridCenter 反解');
}

/* ---- 2. 密度配色与半径 ---- */
console.log('\n[2] 密度配色与半径');
{
  eq(G.densityColor(1), '#66bb6a', '1 人绿色');
  eq(G.densityColor(2), '#f57c00', '2 人橙色');
  eq(G.densityColor(3), '#f57c00', '3 人橙色');
  eq(G.densityColor(4), '#e53935', '4 人红色');
  eq(G.densityColor(50), '#e53935', '50 人仍红色');
  eq(G.circleRadius(1), 500, '1 人半径 500m');
  eq(G.circleRadius(4), 800, '4 人半径 800m');
  eq(G.circleRadius(99), 800, '半径封顶 800m');
}

/* ---- 3. circles 构建（喂给地图组件） ---- */
console.log('\n[3] buildCircles');
{
  const circles = G.buildCircles([
    { grid: '39.90,116.41', count: 2 },
    { grid: '-33.92,151.23', count: 9 }
  ]);
  eq(circles.length, 2, '每个网格一个圈');
  eq(circles[0].latitude, 39.90, '纬度取格中心');
  eq(circles[0].color, '#f57c00cc', '描边带透明度 cc');
  eq(circles[0].fillColor, '#f57c0055', '填充带透明度 55');
  eq(circles[0].strokeWidth, 2, '描边宽 2');
  eq(circles[1].radius, 800, '第二圈半径封顶');
  eq(G.buildCircles([]), [], '空数组不炸');
  eq(G.buildCircles(null), [], 'null 不炸');
  eq(G.buildCircles(undefined), [], 'undefined 不炸');
}

/* ---- 4. 演示数据（未开通云开发时的假数据） ---- */
console.log('\n[4] 演示数据');
{
  const cells = G.demoCells(39.90, 116.41);
  eq(cells.length, 5, '5 个演示网格');
  ok(cells.every(function (c) { return /^-?\d+\.\d+,-?\d+\.\d+$/.test(c.grid); }),
    '所有 grid 都是合法 key 格式（能过云函数的正则校验）');
  const counts = cells.map(function (c) { return c.count; }).sort();
  eq(counts, [1, 1, 2, 2, 4], '人数分布 1/1/2/2/4');
  // 演示网格必须落在中心点 ±0.1° 内，否则密度查询根本查不到自己
  ok(cells.every(function (c) {
    var p = G.gridCenter(c.grid);
    return Math.abs(p.latitude - 39.90) <= 0.1 && Math.abs(p.longitude - 116.41) <= 0.1;
  }), '所有演示格都在中心 ±0.1° 内');
}

console.log('\n结果：' + passed + ' 通过，' + failed + ' 失败');
process.exit(failed ? 1 : 0);
