/* 生成小程序 tabBar 图标（81×81 PNG，透明底），纯 Node，无外部依赖。
   用法：node gen-tabbar-icons.js → 输出到 miniprogram/images/ */
const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

/* ---- PNG 编码（与 gen-icons.js 相同） ---- */
const crcTable = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4); crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}
function encodePNG(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0; // 8-bit RGBA
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

/* ---- 形状判定（坐标即 81×81 画布空间，返回是否在形状内） ---- */
function inDisk(x, y, cx, cy, r) {
  const dx = x - cx, dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}
function inRR(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.max(x0 + r, Math.min(x, x1 - r));
  const cy = Math.max(y0 + r, Math.min(y, y1 - r));
  const dx = x - cx, dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}
/* 带圆头的粗线段 */
function inSeg(x, y, ax, ay, bx, by, w) {
  const vx = bx - ax, vy = by - ay;
  const len2 = vx * vx + vy * vy;
  let t = len2 ? ((x - ax) * vx + (y - ay) * vy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const dx = x - (ax + t * vx), dy = y - (ay + t * vy);
  const r = w / 2;
  return dx * dx + dy * dy <= r * r;
}

/* ---- 三个图标 ---- */
/* 记录：日历（圆角外框 + 顶部两个装订柱 + 表头线 + 三个日期点） */
function shapeRecords(x, y) {
  if (inRR(x, y, 10, 14, 71, 71, 9) && !inRR(x, y, 15, 19, 66, 66, 5)) return true;
  if (x >= 21.5 && x <= 26.5 && y >= 8 && y <= 20) return true;
  if (x >= 54.5 && x <= 59.5 && y >= 8 && y <= 20) return true;
  if (x >= 10 && x <= 71 && y >= 28 && y <= 32.5) return true;
  if (inDisk(x, y, 24, 48, 4)) return true;
  if (inDisk(x, y, 40.5, 48, 4)) return true;
  if (inDisk(x, y, 57, 48, 4)) return true;
  return false;
}
/* 装备：网球拍（圆环拍框 + 网线 + 斜向拍柄 + 一颗球） */
function shapeGear(x, y) {
  const hx = 33, hy = 31, R = 23, ri = 17.5;
  if (inDisk(x, y, hx, hy, R) && !inDisk(x, y, hx, hy, ri)) return true;
  if (inDisk(x, y, hx, hy, ri - 1) &&
      (Math.abs(x - 26) <= 1.1 || Math.abs(x - 40) <= 1.1 ||
       Math.abs(y - 24) <= 1.1 || Math.abs(y - 38) <= 1.1)) return true;
  if (inSeg(x, y, 48.5, 46.5, 64, 62, 8.5)) return true;
  if (inDisk(x, y, 66, 16, 6)) return true;
  return false;
}
/* 统计：三根高度递增的圆头柱 */
function shapeStats(x, y) {
  if (inRR(x, y, 13, 44, 27, 66, 6)) return true;
  if (inRR(x, y, 34, 30, 48, 66, 6)) return true;
  if (inRR(x, y, 55, 16, 69, 66, 6)) return true;
  return false;
}

/* ---- 渲染：3×3 超采样抗锯齿，输出彩色描边 ---- */
const SIZE = 81, SS = 3;
function render(shapeFn, color) {
  const rgba = Buffer.alloc(SIZE * SIZE * 4);
  for (let py = 0; py < SIZE; py++) {
    for (let px = 0; px < SIZE; px++) {
      let cov = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          if (shapeFn(px + (sx + 0.5) / SS, py + (sy + 0.5) / SS)) cov++;
        }
      }
      const i = (py * SIZE + px) * 4;
      rgba[i] = color[0]; rgba[i + 1] = color[1]; rgba[i + 2] = color[2];
      rgba[i + 3] = Math.round(cov / (SS * SS) * 255);
    }
  }
  return encodePNG(SIZE, SIZE, rgba);
}

const GRAY = [138, 143, 138];  // #8a8f8a（tabBar 未选中）
const GREEN = [46, 125, 50];   // #2e7d32（tabBar 选中）

const icons = {
  'tab-records': shapeRecords,
  'tab-gear': shapeGear,
  'tab-stats': shapeStats
};

const dir = path.join(__dirname, 'miniprogram', 'images');
fs.mkdirSync(dir, { recursive: true });
Object.keys(icons).forEach(function (name) {
  fs.writeFileSync(path.join(dir, name + '.png'), render(icons[name], GRAY));
  fs.writeFileSync(path.join(dir, name + '-active.png'), render(icons[name], GREEN));
});
console.log('tabBar icons generated in', dir);
