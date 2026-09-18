/* 开发者工具「模拟饰品」层。
   微信开发者工具的模拟器没有蓝牙，BLE 接口全部报错 —— 这个文件在
   utils/ble.js 顶部、只在 devtools 环境下 install()：把 wx 的蓝牙接口
   换成假的，模拟一台 Tennis Charm 01。扫描、连接、状态回报、灯效命令、
   断连提醒的完整流程都能在工具里跑通，页面代码一行不改；真机不经过这里。

   行为与固件 charm_xiao_nrf52840.ino 保持同一套规则：
   - 广播带服务 UUID，已连接时停广播（断开后恢复，对应 restartOnDisconnect）
   - 订阅状态后每 5 秒推一帧，收到合法命令也回一帧
   - 帧校验（长度声明 + 异或）不过就静默丢弃，未知命令不回状态
   - 雷达是一次性效果：1.6 秒后回到之前的模式（期间切了别的模式就不回跳） */

var proto = require('./ble-protocol');

var MODE_RAINBOW = 5;
var MODE_RADAR = 6;
var RADAR_MS = 1600;
var STATUS_INTERVAL_MS = 5000;

var charm = {
  deviceId: 'MOCK-TENNIS-CHARM-01',
  name: 'Tennis Charm 01',
  mode: 2,               // 呼吸
  prevMode: 2,
  color: { r: 204, g: 255, b: 0 },   // 网球黄绿
  brightness: 90,
  battery: 85,
  advertising: true,     // 已连接 = false，对应固件连上停广播
  connected: false
};

var foundCb = null;
var valueChangeCb = null;
var connStateCb = null;
var discoverTimer = null;
var statusTimer = null;
var firstPushTimer = null;
var radarTimer = null;

/* ---------- 状态帧：[0xA5, 电量%, 模式, R, G, B, 亮度, XOR]，定长 8 ---------- */
function pushStatus() {
  if (!valueChangeCb || !charm.connected) return;
  var b = [0xA5, charm.battery, charm.mode, charm.color.r, charm.color.g, charm.color.b, charm.brightness, 0];
  var x = 0;
  for (var i = 0; i < 7; i++) x ^= b[i];
  b[7] = x;
  valueChangeCb({ deviceId: charm.deviceId, value: proto.toBuffer(b) });
}

/* ---------- 命令帧：与固件 applyFrame 同一套分支 ---------- */
function applyFrame(bytes) {
  if (!proto.isValidFrame(bytes)) return;   // 坏帧：静默丢弃，不回状态
  var cmd = bytes[0];
  var p = bytes.slice(2);
  switch (cmd) {
    case proto.CMD_SET_MODE:
      if (p.length >= 1 && p[0] <= MODE_RAINBOW) charm.mode = p[0];   // 固件 setMode：>5 不应用
      break;
    case proto.CMD_SET_COLOR:
      if (p.length >= 3) charm.color = { r: p[0], g: p[1], b: p[2] }; // 固件要 plen>=3
      break;
    case proto.CMD_SET_BRIGHT:
      if (p.length >= 1) charm.brightness = p[0];
      break;
    case proto.CMD_TRIGGER:
      if (p.length >= 1 && p[0] === MODE_RADAR) triggerRadar();
      break;
    case proto.CMD_BIND:
      break;   // v0.1 固件只存 RAM 不校验
    default:
      return;  // 未知命令：连状态都不回，省电（同固件）
  }
  setTimeout(pushStatus, 120);   // 固件是立即回，留一点延迟更像真蓝牙
}

function triggerRadar() {
  if (radarTimer) { clearTimeout(radarTimer); radarTimer = null; }
  if (charm.mode !== MODE_RADAR) charm.prevMode = charm.mode;
  charm.mode = MODE_RADAR;
  radarTimer = setTimeout(function () {
    radarTimer = null;
    if (charm.mode !== MODE_RADAR) return;   // 期间切了模式就不回跳，同固件
    charm.mode = charm.prevMode;
    pushStatus();
  }, RADAR_MS);
}

/* ---------- 安装：替换 wx 蓝牙接口 ----------
   opt.statusIntervalMs 可覆盖 5 秒周期推送（node test-ble-mock.js 用它把周期帧
   关掉，让断言只看命令回帧，不被定时器干扰）。 */
function install(opt) {
  var statusIntervalMs = (opt && opt.statusIntervalMs) || STATUS_INTERVAL_MS;
  wx.openBluetoothAdapter = function (opt) {
    opt = opt || {};
    setTimeout(function () {
      (opt.success || function () {})({ errMsg: 'openBluetoothAdapter:ok' });
    }, 100);
  };

  wx.onBluetoothDeviceFound = function (cb) { foundCb = cb; };
  wx.offBluetoothDeviceFound = function () { foundCb = null; };

  wx.startBluetoothDevicesDiscovery = function (opt) {
    opt = opt || {};
    if (discoverTimer) { clearTimeout(discoverTimer); discoverTimer = null; }
    if (charm.advertising) {
      discoverTimer = setTimeout(function () {   // 扫 1.5 秒才出现，留出扫描态
        discoverTimer = null;
        if (foundCb && charm.advertising) {
          foundCb({
            devices: [{
              deviceId: charm.deviceId,
              name: charm.name,
              localName: charm.name,
              RSSI: -55,
              advertisServiceUUIDs: [proto.SERVICE_UUID]
            }]
          });
        }
      }, 1500);
    }
    setTimeout(function () {
      (opt.success || function () {})({ errMsg: 'startBluetoothDevicesDiscovery:ok' });
    }, 80);
  };

  wx.stopBluetoothDevicesDiscovery = function (opt) {
    opt = opt || {};
    if (discoverTimer) { clearTimeout(discoverTimer); discoverTimer = null; }
    (opt.success || function () {})({ errMsg: 'stopBluetoothDevicesDiscovery:ok' });
  };

  wx.createBLEConnection = function (opt) {
    opt = opt || {};
    setTimeout(function () {
      if (opt.deviceId !== charm.deviceId || !charm.advertising) {
        (opt.fail || function () {})({ errMsg: 'createBLEConnection:fail device not found' });
        return;
      }
      charm.connected = true;
      charm.advertising = false;   // 连上停广播
      (opt.success || function () {})({ errMsg: 'createBLEConnection:ok' });
    }, 600);
  };

  wx.closeBLEConnection = function (opt) {
    opt = opt || {};
    if (opt.deviceId === charm.deviceId && charm.connected) {
      charm.connected = false;
      charm.advertising = true;   // 断开恢复广播，对应 restartOnDisconnect(true)
      if (statusTimer) { clearInterval(statusTimer); statusTimer = null; }
      if (firstPushTimer) { clearTimeout(firstPushTimer); firstPushTimer = null; }
      if (radarTimer) { clearTimeout(radarTimer); radarTimer = null; charm.mode = charm.prevMode; }
      /* 异步派发断连事件：ble.disconnect() 是先调 close 再清 state，
         同步派发会被它自己的 state.deviceId 匹配到，误触发"饰品已断开"弹窗 */
      setTimeout(function () {
        if (connStateCb) connStateCb({ deviceId: charm.deviceId, connected: false });
      }, 60);
    }
    (opt.success || function () {})({ errMsg: 'closeBLEConnection:ok' });
  };

  wx.onBLEConnectionStateChange = function (cb) { connStateCb = cb; };
  wx.offBLEConnectionStateChange = function () { connStateCb = null; };

  wx.getBLEDeviceServices = function (opt) {
    opt = opt || {};
    setTimeout(function () {
      (opt.success || function () {})({
        errMsg: 'getBLEDeviceServices:ok',
        services: [{ uuid: proto.SERVICE_UUID, isPrimary: true }]
      });
    }, 150);
  };

  wx.getBLEDeviceCharacteristics = function (opt) {
    opt = opt || {};
    setTimeout(function () {
      (opt.success || function () {})({
        errMsg: 'getBLEDeviceCharacteristics:ok',
        characteristics: [
          { uuid: proto.CMD_CHAR_UUID, properties: { write: true, writeNoResponse: true } },
          { uuid: proto.STATUS_CHAR_UUID, properties: { read: true, notify: true } }
        ]
      });
    }, 150);
  };

  wx.notifyBLECharacteristicValueChange = function (opt) {
    opt = opt || {};
    setTimeout(function () {
      if (!charm.connected) {
        (opt.fail || function () {})({ errMsg: 'notifyBLECharacteristicValueChange:fail not connected' });
        return;
      }
      (opt.success || function () {})({ errMsg: 'notifyBLECharacteristicValueChange:ok' });
      if (opt.state) {
        firstPushTimer = setTimeout(pushStatus, 400);   // 订阅成功后先来一帧
        statusTimer = setInterval(pushStatus, statusIntervalMs);
      }
    }, 100);
  };

  wx.onBLECharacteristicValueChange = function (cb) { valueChangeCb = cb; };
  wx.offBLECharacteristicValueChange = function () { valueChangeCb = null; };

  wx.writeBLECharacteristicValue = function (opt) {
    opt = opt || {};
    setTimeout(function () {
      if (!charm.connected || opt.characteristicId !== proto.CMD_CHAR_UUID) {
        (opt.fail || function () {})({ errMsg: 'writeBLECharacteristicValue:fail' });
        return;
      }
      applyFrame(proto.fromBuffer(opt.value));   // 帧不合法时 success 但不回状态，同固件
      (opt.success || function () {})({ errMsg: 'writeBLECharacteristicValue:ok' });
    }, 80);
  };
}

module.exports = { install: install };
