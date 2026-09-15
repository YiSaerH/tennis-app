/**
 * 定时清理过期的位置记录（每 30 分钟触发一次，见 config.json）
 */
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

exports.main = async () => {
  const res = await db.collection('presence')
    .where({ expireAt: _.lt(Date.now()) })
    .remove();
  return { removed: res.stats ? res.stats.removed : 0 };
};
