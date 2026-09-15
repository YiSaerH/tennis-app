/* 智能饰品 BLE 协议（纯逻辑，node test-ble-protocol.js 可直接跑；与固件端帧格式一一对应）：
   Service   a5e00001-7a1e-4c6d-9b3f-2e8f5a6b0001（固件把它放进广播，供小程序过滤扫描）
   命令通道   a5e00002-…（写）   状态通道 a5e00003-…（通知）
   命令帧 [CMD, LEN, payload…, XOR]：XOR 为前面所有字节的异或校验
   状态帧 [0xA5, 电量%, 模式, R, G, B, 亮度, XOR]（定长 8 字节） */

var SERVICE_UUID = 'a5e00001-7a1e-4c6d-9b3f-2e8f5a6b0001';
var CMD_CHAR_UUID = 'a5e00002-7a1e-4c6d-9b3f-2e8f5a6b0001';
var STATUS_CHAR_UUID = 'a5e00003-7a1e-4c6d-9b3f-2e8f5a6b0001';

var CMD_SET_MODE = 0x01;    // payload: [模式]
var CMD_SET_COLOR = 0x02;   // payload: [R, G, B]
var CMD_SET_BRIGHT = 0x03;  // payload: [亮度 0-255]
var CMD_TRIGGER = 0x04;     // payload: [效果号]，目前 6=雷达闪烁（一次性）
var CMD_BIND = 0x10;        // payload: 16 字节随机 token（v0.1 固件只存 RAM，鉴权在 v0.2）

/* 模式值与 UI 文案（固件里的 switch 分支同号） */
var MODES = [
  { v: 0, label: '关' },
  { v: 1, label: '热身' },
  { v: 2, label: '呼吸' },
  { v: 3, label: '心跳' },
  { v: 4, label: '弹跳' },
  { v: 5, label: '彩虹' },
  { v: 6, label: '雷达' }
];
function modeLabel(v) {
  for (var i = 0; i < MODES.length; i++) {
    if (MODES[i].v === v) return MODES[i].label;
  }
  return '—';
}

/* ---------- 校验与编码 ---------- */
function xorBytes(bytes, from, to) {
  var x = 0;
  for (var i = from; i < to; i++) x ^= bytes[i];
  return x & 0xFF;
}

/* [CMD, LEN, payload…, XOR] */
function encodeFrame(cmd, payload) {
  var p = payload || [];
  var bytes = [cmd, p.length].concat(p);
  bytes.push(xorBytes(bytes, 0, bytes.length));
  return bytes;
}

/* 校验收到的命令帧（长度声明 + 异或校验），固件端用同一套规则 */
function isValidFrame(bytes) {
  if (!bytes || bytes.length < 3) return false;
  if (bytes[1] !== bytes.length - 3) return false;
  return xorBytes(bytes, 0, bytes.length - 1) === bytes[bytes.length - 1];
}

function encodeSetMode(mode) { return encodeFrame(CMD_SET_MODE, [mode]); }
function encodeSetColor(r, g, b) { return encodeFrame(CMD_SET_COLOR, [r, g, b]); }
function encodeSetBrightness(b) { return encodeFrame(CMD_SET_BRIGHT, [b]); }
function encodeTrigger(effect) { return encodeFrame(CMD_TRIGGER, [effect]); }

/* 16 字节 token 的 hex 字符串（32 个字符）→ 绑定帧 */
function encodeBind(tokenHex) {
  var payload = [];
  var hex = String(tokenHex || '');
  for (var i = 0; i + 1 < hex.length; i += 2) {
    payload.push(parseInt(hex.substr(i, 2), 16));
  }
  return encodeFrame(CMD_BIND, payload);
}

/* ---------- 状态帧 ---------- */
function parseStatus(bytes) {
  if (!bytes || bytes.length !== 8) return null;
  if (bytes[0] !== 0xA5) return null;
  if (xorBytes(bytes, 0, 7) !== bytes[7]) return null;
  return {
    battery: bytes[1],
    mode: bytes[2],
    color: rgbToHex(bytes[3], bytes[4], bytes[5]),
    brightness: bytes[6]
  };
}

/* ---------- 颜色 ---------- */
function hexToRgb(hex) {
  var m = /^#?([0-9a-fA-F]{6})$/.exec(String(hex || ''));
  if (!m) return null;
  var n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
function rgbToHex(r, g, b) {
  var s = '000000' + ((r << 16) | (g << 8) | b).toString(16);
  return '#' + s.slice(-6);
}

/* ---------- 字节数组 ↔ ArrayBuffer（wx 蓝牙接口只收发 ArrayBuffer） ---------- */
function toBuffer(bytes) {
  return new Uint8Array(bytes).buffer;
}
function fromBuffer(buffer) {
  return Array.prototype.slice.call(new Uint8Array(buffer));
}

module.exports = {
  SERVICE_UUID: SERVICE_UUID,
  CMD_CHAR_UUID: CMD_CHAR_UUID,
  STATUS_CHAR_UUID: STATUS_CHAR_UUID,
  CMD_SET_MODE: CMD_SET_MODE,
  CMD_SET_COLOR: CMD_SET_COLOR,
  CMD_SET_BRIGHT: CMD_SET_BRIGHT,
  CMD_TRIGGER: CMD_TRIGGER,
  CMD_BIND: CMD_BIND,
  MODES: MODES,
  modeLabel: modeLabel,
  encodeFrame: encodeFrame,
  isValidFrame: isValidFrame,
  encodeSetMode: encodeSetMode,
  encodeSetColor: encodeSetColor,
  encodeSetBrightness: encodeSetBrightness,
  encodeTrigger: encodeTrigger,
  encodeBind: encodeBind,
  parseStatus: parseStatus,
  hexToRgb: hexToRgb,
  rgbToHex: rgbToHex,
  toBuffer: toBuffer,
  fromBuffer: fromBuffer
};
