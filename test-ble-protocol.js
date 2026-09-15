/* 智能饰品 BLE 协议自测：node test-ble-protocol.js
   miniprogram/utils/ble-protocol.js 是纯逻辑模块（不依赖 wx），直接跑。
   帧格式必须与 firmware/charm_xiao_nrf52840/charm_xiao_nrf52840.ino 的 applyFrame/sendStatus 一致。 */
const path = require('path');

const P = require(path.join(__dirname, 'miniprogram', 'utils', 'ble-protocol.js'));

let passed = 0, failed = 0;
function ok(cond, msg) {
  if (cond) { passed++; console.log('  ✓ ' + msg); }
  else { failed++; console.log('  ✗ ' + msg); }
}
function eq(a, b, msg) {
  ok(JSON.stringify(a) === JSON.stringify(b),
    msg + ' → 得到 ' + JSON.stringify(a) + '，期望 ' + JSON.stringify(b));
}

/* ---- 1. 帧编码 ---- */
console.log('\n[1] 命令帧编码 [CMD, LEN, payload…, XOR]');
{
  eq(P.encodeSetMode(3), [0x01, 0x01, 3, 0x03], 'SET_MODE(心跳) → 01 01 03 03');
  eq(P.encodeSetColor(255, 0, 128), [0x02, 0x03, 255, 0, 128, 126], 'SET_COLOR(255,0,128)');
  eq(P.encodeSetBrightness(200), [0x03, 0x01, 200, 202], 'SET_BRIGHTNESS(200) → 03 01 C8 CA');
  eq(P.encodeTrigger(6), [0x04, 0x01, 6, 0x03], 'TRIGGER(雷达) → 04 01 06 03');

  // XOR 手工复核：01 01 03 → 0x01^0x01^0x03 = 0x03
  ok(P.encodeSetMode(3)[3] === (0x01 ^ 0x01 ^ 0x03), 'XOR 覆盖 cmd+len+payload');
}

/* ---- 2. 帧校验 ---- */
console.log('\n[2] isValidFrame');
{
  const f = P.encodeSetMode(5);
  ok(P.isValidFrame(f) === true, '自己编的帧能过校验');
  const broken = f.slice();
  broken[2] = 2;   // 篡改 payload，XOR 失配
  ok(P.isValidFrame(broken) === false, '篡改 payload → 校验失败');
  const badLen = f.slice();
  badLen[1] = 9;   // 长度声明不符
  ok(P.isValidFrame(badLen) === false, '长度声明不符 → 校验失败');
  ok(P.isValidFrame([0x01]) === false, '太短（<3 字节）→ false');
  ok(P.isValidFrame(null) === false, 'null → false');
}

/* ---- 3. 绑定帧（16 字节 token） ---- */
console.log('\n[3] 绑定帧');
{
  const tokenHex = '00112233445566778899aabbccddeeff';
  const f = P.encodeBind(tokenHex);
  eq(f.length, 19, '总长 19 = 1 cmd + 1 len + 16 token + 1 xor');
  eq(f[1], 16, 'LEN = 16');
  eq(f.slice(2, 18), [0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88, 0x99, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff], 'token 按字节原样进 payload');
  ok(P.isValidFrame(f) === true, '绑定帧通过校验');
}

/* ---- 4. 状态帧解析（与固件 sendStatus 对应） ---- */
console.log('\n[4] parseStatus（[0xA5, 电量, 模式, R, G, B, 亮度, XOR]）');
{
  const b = [0xA5, 85, 3, 204, 255, 0, 90, 0];
  b[7] = 0; // 先占位
  let x = 0;
  for (let i = 0; i < 7; i++) x ^= b[i];
  b[7] = x;
  const st = P.parseStatus(b);
  eq(st, { battery: 85, mode: 3, color: '#ccff00', brightness: 90 }, '正常状态帧 → 电量 85%、心跳模式、网球黄绿、亮度 90');

  ok(P.parseStatus([0xA5, 85, 3, 204, 255, 0, 90]) === null, '7 字节（短）→ null');
  ok(P.parseStatus([0x00].concat([85, 3, 204, 255, 0, 90, 0])) === null, '魔数不是 0xA5 → null');
  const bad = b.slice(); bad[1] = 50;   // 篡改电量
  ok(P.parseStatus(bad) === null, '篡改电量 → XOR 失败 → null');
  ok(P.parseStatus(null) === null, 'null → null');
}

/* ---- 5. 颜色转换 ---- */
console.log('\n[5] 颜色转换');
{
  eq(P.hexToRgb('#ccff00'), { r: 204, g: 255, b: 0 }, 'hexToRgb 网球黄绿');
  eq(P.hexToRgb('ccff00'), { r: 204, g: 255, b: 0 }, '不带 # 也认');
  ok(P.hexToRgb('#ccf') === null, '3 位缩写不认（避免歧义）');
  ok(P.hexToRgb('垃圾') === null, '垃圾输入 → null');
  eq(P.rgbToHex(204, 255, 0), '#ccff00', 'rgbToHex');
  eq(P.rgbToHex(0, 0, 0), '#000000', '黑色补零');
  // 往返
  const rgb = P.hexToRgb('#e040fb');
  eq(P.rgbToHex(rgb.r, rgb.g, rgb.b), '#e040fb', 'hex→rgb→hex 往返一致');
}

/* ---- 6. ArrayBuffer 转换（wx 蓝牙接口只收发 ArrayBuffer） ---- */
console.log('\n[6] ArrayBuffer 转换');
{
  const bytes = P.encodeSetMode(2);
  const buf = P.toBuffer(bytes);
  ok(buf instanceof ArrayBuffer, 'toBuffer 返回 ArrayBuffer');
  eq(P.fromBuffer(buf), bytes, 'fromBuffer 反解一致');
  ok(Array.isArray(P.fromBuffer(buf)), 'fromBuffer 返回普通数组');
}

console.log('\n结果：' + passed + ' 通过，' + failed + ' 失败');
process.exit(failed ? 1 : 0);
