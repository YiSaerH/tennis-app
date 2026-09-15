/**
 * 上报我的位置网格（心跳 / 打卡 / 下线）
 * 隐私设计：文档 _id 是 openid 的 HMAC 摘要，云端不存任何可反查的身份证；
 *          只存约 1 公里的网格点（"lat,lng" 各保留 2 位小数），不存精确位置。
 */
const cloud = require('wx-server-sdk');
const crypto = require('crypto');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

/* 部署后请改成自己的随机字符串（改了旧数据会自然过期消失，属于正常现象） */
const SALT = 'tennis-charm-salt-change-me';

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  const id = crypto.createHmac('sha256', SALT).update(OPENID).digest('hex').slice(0, 16);

  const ttl = Math.min(parseInt(event.ttl, 10) || 0, 7200);  // 最长 2 小时

  // ttl=0 表示下线，直接删掉自己的记录
  if (ttl <= 0) {
    try {
      await db.collection('presence').doc(id).remove();
    } catch (e) { /* 文档不存在时忽略 */ }
    return { ok: true, action: 'off' };
  }

  const grid = String(event.grid || '');
  if (!/^-?\d+\.\d+,-?\d+\.\d+$/.test(grid)) {
    throw new Error('bad grid');
  }
  const parts = grid.split(',').map(Number);

  const now = Date.now();
  await db.collection('presence').doc(id).set({
    data: {
      grid: grid,
      gridLat: parts[0],
      gridLng: parts[1],
      lastSeen: now,
      expireAt: now + ttl * 1000
    }
  });

  return { ok: true, action: ttl >= 7200 ? 'checkin' : 'ping' };
};
