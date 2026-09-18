/* wx 蓝牙（BLE）封装：统一处理适配器 / 扫描 / 连接 / 写入 / 通知，
   页面代码只管业务。与饰品的字节协议见 utils/ble-protocol.js。
   注意：微信开发者工具的模拟器没有蓝牙 —— 工具里由 ble-mock.js 模拟一台
   饰品跑通全流程（调 UI 用）；真机和真实饰品不受影响，走下面的真接口。 */

var proto = require('./ble-protocol');

/* 仅开发者工具：替换 wx 蓝牙接口为模拟饰品（platform==='devtools' 只在工具里成立） */
try {
  if (typeof wx !== 'undefined' && wx.getSystemInfoSync().platform === 'devtools') {
    require('./ble-mock').install();
  }
} catch (e) { }

var state = {
  adapterReady: false,
  deviceId: '',
  serviceId: '',
  cmdCharId: '',
  statusCharId: '',
  connected: false
};
var statusCb = null;      // 状态通知回调（电量/模式/颜色/亮度）
var disconnectCb = null;  // 断连回调（防丢提醒用）

/* ---------- 适配器 ---------- */
function ensureAdapter(cb) {
  if (state.adapterReady) { cb(null); return; }
  wx.openBluetoothAdapter({
    success() { state.adapterReady = true; cb(null); },
    fail(res) { cb(res); }
  });
}

/* off* 系列在低版本基础库上可能没有，能清就清，防止回调叠加 */
function offFound() {
  if (wx.offBluetoothDeviceFound) wx.offBluetoothDeviceFound();
}

/* ---------- 扫描（按服务 UUID 过滤广播，只报出饰品） ---------- */
/* durationSec 秒内收集到的设备列表一次性回调 */
function scanCharm(durationSec, cb) {
  var seen = {};
  var devices = [];
  var finished = false;
  var timer = null;
  ensureAdapter(function (err) {
    if (err) { cb(err); return; }
    offFound();
    wx.onBluetoothDeviceFound(function (res) {
      res.devices.forEach(function (d) {
        if (seen[d.deviceId]) return;
        seen[d.deviceId] = true;
        devices.push(d);
      });
    });
    wx.startBluetoothDevicesDiscovery({
      services: [proto.SERVICE_UUID],
      allowDuplicatesKey: false,
      success() {
        timer = setTimeout(function () {
          if (finished) return;
          finished = true;
          wx.stopBluetoothDevicesDiscovery();
          cb(null, devices);
        }, (durationSec || 6) * 1000);
      },
      fail(res) {
        if (finished) return;
        finished = true;
        cb(res);
      }
    });
  });
}

/* ---------- 附近球友雷达（v0.1 手机代扫）----------
   扫描广播同一服务 UUID 的设备，出现第一个非自己的设备就立刻回调。
   已连接的饰品会停广播，所以扫到的一定是别人的（再把 selfId 排除一遍更稳）。 */
function radarScan(handlers) {
  var done = false;
  var timer = null;
  var selfId = state.deviceId;
  function finish(found) {
    if (done) return;
    done = true;
    if (timer) { clearTimeout(timer); timer = null; }
    wx.stopBluetoothDevicesDiscovery();
    handlers.onDone(found);
  }
  ensureAdapter(function (err) {
    if (err) { handlers.onDone(false); return; }
    offFound();
    wx.onBluetoothDeviceFound(function (res) {
      var peer = null;
      res.devices.forEach(function (d) {
        if (d.deviceId !== selfId && !peer) peer = d;
      });
      if (peer) {
        finish(true);
        handlers.onPeer(peer);
      }
    });
    wx.startBluetoothDevicesDiscovery({
      services: [proto.SERVICE_UUID],
      allowDuplicatesKey: false,
      success() {
        timer = setTimeout(function () { finish(false); }, 15000);
      },
      fail() { finish(false); }
    });
  });
}

/* ---------- 连接 ---------- */
function connect(deviceId, cb) {
  wx.createBLEConnection({
    deviceId: deviceId,
    success() { discoverChars(deviceId, cb); },
    fail(res) { cb(res); }
  });
}

/* 找到我们的服务 + 命令/状态两条特征值，订阅状态通知 */
function discoverChars(deviceId, cb) {
  wx.getBLEDeviceServices({
    deviceId: deviceId,
    success(res) {
      var svc = null;
      res.services.forEach(function (s) {
        if (String(s.uuid).toLowerCase() === proto.SERVICE_UUID) svc = s;
      });
      if (!svc) { cb({ errMsg: '找不到饰品服务（固件版本不匹配）' }); return; }
      wx.getBLEDeviceCharacteristics({
        deviceId: deviceId,
        serviceId: svc.uuid,
        success(res2) {
          var cmd = null, st = null;
          res2.characteristics.forEach(function (c) {
            var u = String(c.uuid).toLowerCase();
            if (u === proto.CMD_CHAR_UUID && c.properties.write) cmd = c;
            if (u === proto.STATUS_CHAR_UUID && c.properties.notify) st = c;
          });
          if (!cmd) { cb({ errMsg: '饰品固件缺少命令通道' }); return; }
          state.deviceId = deviceId;
          state.serviceId = svc.uuid;
          state.cmdCharId = cmd.uuid;
          state.statusCharId = st ? st.uuid : '';
          state.connected = true;
          subscribeNotify();
          cb(null);
        },
        fail(res) { cb(res); }
      });
    },
    fail(res) { cb(res); }
  });
}

function subscribeNotify() {
  if (wx.offBLEConnectionStateChange) wx.offBLEConnectionStateChange();
  wx.onBLEConnectionStateChange(function (res) {
    if (!res.connected && res.deviceId === state.deviceId) {
      state.connected = false;
      if (disconnectCb) disconnectCb();
    }
  });
  if (!state.statusCharId) return;
  wx.notifyBLECharacteristicValueChange({
    deviceId: state.deviceId,
    serviceId: state.serviceId,
    characteristicId: state.statusCharId,
    state: true
  });
  if (wx.offBLECharacteristicValueChange) wx.offBLECharacteristicValueChange();
  wx.onBLECharacteristicValueChange(function (res) {
    if (res.deviceId !== state.deviceId) return;
    var parsed = proto.parseStatus(proto.fromBuffer(res.value));
    if (parsed && statusCb) statusCb(parsed);
  });
}

/* ---------- 写命令（未连接时静默跳过） ---------- */
function write(bytes, cb) {
  if (!state.connected) {
    if (cb) cb({ errMsg: '饰品未连接' });
    return;
  }
  wx.writeBLECharacteristicValue({
    deviceId: state.deviceId,
    serviceId: state.serviceId,
    characteristicId: state.cmdCharId,
    value: proto.toBuffer(bytes),
    success() { if (cb) cb(null); },
    fail(res) { if (cb) cb(res); }
  });
}

function isConnected() { return state.connected; }
function sendMode(mode, cb) { write(proto.encodeSetMode(mode), cb); }
function sendBrightness(b, cb) { write(proto.encodeSetBrightness(b), cb); }
function sendColor(hex, cb) {
  var c = proto.hexToRgb(hex);
  if (c) write(proto.encodeSetColor(c.r, c.g, c.b), cb);
}
function sendTrigger(effect, cb) { write(proto.encodeTrigger(effect), cb); }
function onStatus(cb) { statusCb = cb; }
function onDisconnect(cb) { disconnectCb = cb; }

function disconnect() {
  if (state.deviceId) {
    try { wx.closeBLEConnection({ deviceId: state.deviceId }); } catch (e) { }
  }
  state.connected = false;
  state.deviceId = '';
  state.serviceId = '';
  state.cmdCharId = '';
  state.statusCharId = '';
}

module.exports = {
  ensureAdapter: ensureAdapter,
  scanCharm: scanCharm,
  radarScan: radarScan,
  connect: connect,
  write: write,
  isConnected: isConnected,
  sendMode: sendMode,
  sendBrightness: sendBrightness,
  sendColor: sendColor,
  sendTrigger: sendTrigger,
  onStatus: onStatus,
  onDisconnect: onDisconnect,
  disconnect: disconnect
};
