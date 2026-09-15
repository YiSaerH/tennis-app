/**
 * 查询附近约 ±0.15°（十几公里）范围内的球友密度
 * 只返回网格中心 + 人数，不返回任何身份信息。
 */
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const RANGE = 0.15;   // 纬经度各 ±0.15°
const MAX_CELLS = 200;

exports.main = async (event) => {
  const lat = parseFloat(event.lat);
  const lng = parseFloat(event.lng);
  if (isNaN(lat) || isNaN(lng)) {
    throw new Error('bad lat/lng');
  }

  const res = await db.collection('presence')
    .where({
      expireAt: _.gt(Date.now()),
      gridLat: _.gte(lat - RANGE).and(_.lte(lat + RANGE)),
      gridLng: _.gte(lng - RANGE).and(_.lte(lng + RANGE))
    })
    .limit(1000)
    .get();

  // 数据库端不便做聚合，取回后按网格统计
  const byGrid = {};
  res.data.forEach(function (doc) {
    byGrid[doc.grid] = (byGrid[doc.grid] || 0) + 1;
  });

  const cells = Object.keys(byGrid)
    .map(function (grid) { return { grid: grid, count: byGrid[grid] }; })
    .sort(function (a, b) { return b.count - a.count; })
    .slice(0, MAX_CELLS);

  return { cells: cells };
};
