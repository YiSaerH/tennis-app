/* 模拟饰品层自测：node test-ble-mock.js
   utils/ble-mock.js 平时只在开发者工具里生效（要挂在 wx 上），这里造一个假的
   global.wx 把它装起来，走完整流程：扫描 → 连接 → 订阅 → 命令 → 雷达 → 断开。
   每一步的行为都必须和固件 charm_xiao_nrf52840.ino 一致（applyFrame / sendStatus /
   连上停广播 / 断开恢复广播），改任何一边都要同步改另一边。 */
const path = require('path');

global.wx = {};   // 假的开发者工具宿主对象
const mock = require(path.join(__dirname, 'miniprogram', 'utils', 'ble-mock.js'));
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
function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

/* wx 接口都是 success/fail 回调风格，包成 Promise */
function call(fn, opt) {
  return new Promise(function (resolve, reject) {
    fn(Object.assign({}, opt || {}, {
      success: resolve,
      fail: function (e) { reject(new Error((e && e.errMsg) || 'fail')); }
    }));
  });
}

let devId = '';
let frames = [];   // 收到的状态帧（已 parseStatus）

function writeCmd(bytes) {
  return call(wx.writeBLECharacteristicValue, {
    deviceId: devId,
    serviceId: P.SERVICE_UUID,
    characteristicId: P.CMD_CHAR_UUID,
    value: P.toBuffer(bytes)
  });
}
function lastFrame() { return frames[frames.length - 1]; }

async function main() {
  /* 周期帧关掉（10 分钟），断言只看命令回帧，不被定时器干扰 */
  mock.install({ statusIntervalMs: 600000 });

  /* ---- 1. 初始化与扫描 ---- */
  console.log('\n[1] 初始化与扫描');
  let res = await call(wx.openBluetoothAdapter);
  ok(/:ok/.test(res.errMsg), 'openBluetoothAdapter 成功');

  let found = [];
  wx.onBluetoothDeviceFound(function (r) { found = found.concat(r.devices); });
  await call(wx.startBluetoothDevicesDiscovery, { services: [P.SERVICE_UUID] });
  await wait(1900);
  eq(found.length, 1, '扫 1.5 秒后发现 1 台设备');
  eq(found[0].name, 'Tennis Charm 01', '设备名是 Tennis Charm 01');
  ok(found[0].advertisServiceUUIDs.indexOf(P.SERVICE_UUID) >= 0, '广播里带饰品服务 UUID');
  devId = found[0].deviceId;

  /* ---- 2. 连接与服务发现 ---- */
  console.log('\n[2] 连接与服务发现');
  await call(wx.createBLEConnection, { deviceId: devId });

  let found2 = [];
  wx.onBluetoothDeviceFound(function (r) { found2 = found2.concat(r.devices); });
  await call(wx.startBluetoothDevicesDiscovery, { services: [P.SERVICE_UUID] });
  await wait(1900);
  eq(found2.length, 0, '已连接时停止广播（同固件），再扫扫不到');

  let wrongId = false;
  wx.createBLEConnection({ deviceId: 'OTHER-DEVICE', fail: function () { wrongId = true; } });
  await wait(700);
  ok(wrongId, '未知 deviceId → 连接失败');

  let svcs = await call(wx.getBLEDeviceServices, { deviceId: devId });
  eq(svcs.services[0].uuid, P.SERVICE_UUID, '服务发现返回饰品服务');
  let chrs = await call(wx.getBLEDeviceCharacteristics, { deviceId: devId, serviceId: P.SERVICE_UUID });
  let cmdChr = null, stChr = null;
  chrs.characteristics.forEach(function (c) {
    if (c.uuid === P.CMD_CHAR_UUID) cmdChr = c;
    if (c.uuid === P.STATUS_CHAR_UUID) stChr = c;
  });
  ok(cmdChr && cmdChr.properties.write, '命令通道可写');
  ok(stChr && stChr.properties.notify, '状态通道可订阅');

  /* ---- 3. 订阅状态：首帧 ---- */
  console.log('\n[3] 订阅状态');
  wx.onBLECharacteristicValueChange(function (r) {
    var st = P.parseStatus(P.fromBuffer(r.value));
    if (st) frames.push(st);
  });
  await call(wx.notifyBLECharacteristicValueChange, {
    deviceId: devId, serviceId: P.SERVICE_UUID,
    characteristicId: P.STATUS_CHAR_UUID, state: true
  });
  await wait(600);   // 首帧在订阅后 400ms
  eq(frames.length, 1, '订阅成功后先推一帧');
  eq(frames[0], { battery: 85, mode: 2, color: '#ccff00', brightness: 90 },
    '初始状态：电量 85% / 呼吸 / 网球黄绿 / 亮度 90');

  /* ---- 4. 灯效命令 ---- */
  console.log('\n[4] 灯效命令');
  await writeCmd(P.encodeSetMode(3)); await wait(350);
  eq(lastFrame().mode, 3, 'SET_MODE(心跳) → 回帧模式 3');
  await writeCmd(P.encodeSetColor(255, 82, 82)); await wait(350);
  eq(lastFrame().color, '#ff5252', 'SET_COLOR → 回帧红土色');
  await writeCmd(P.encodeSetBrightness(200)); await wait(350);
  eq(lastFrame().brightness, 200, 'SET_BRIGHTNESS → 回帧亮度 200');

  let n = frames.length;
  await writeCmd(P.encodeSetMode(9)); await wait(350);
  ok(frames.length === n + 1, '越界模式：不生效但照回状态帧（同固件，只有未知命令才不回）');
  eq(lastFrame().mode, 3, '模式保持 3 没被改成 9');
  n = frames.length;
  await writeCmd(P.encodeFrame(P.CMD_SET_COLOR, [255])); await wait(350);
  ok(frames.length === n + 1, 'SET_COLOR 缺字节（plen<3）：不生效但照回状态帧');
  eq(lastFrame().color, '#ff5252', '颜色保持不变');

  /* ---- 5. 坏帧与未知命令：静默丢弃 ---- */
  console.log('\n[5] 坏帧与未知命令');
  n = frames.length;
  await writeCmd([0x01, 0x01, 0x03, 0xFF]);            // XOR 校验不过
  await writeCmd(P.encodeFrame(0x7F, [0x01]));         // 未知命令
  await wait(500);
  eq(frames.length, n, '坏帧 / 未知命令 → 一个状态帧都不回（同固件）');

  /* ---- 6. 雷达是一次性效果 ---- */
  console.log('\n[6] 雷达：1.6 秒后自动回跳');
  await writeCmd(P.encodeTrigger(6)); await wait(350);
  eq(lastFrame().mode, 6, 'TRIGGER(雷达) → 回帧模式 6');
  await wait(1800);
  eq(lastFrame().mode, 3, '1.6 秒后自动回到之前的模式 3');

  /* ---- 7. 雷达期间切了模式就不回跳 ---- */
  console.log('\n[7] 雷达期间切模式');
  await writeCmd(P.encodeTrigger(6)); await wait(350);
  await writeCmd(P.encodeSetMode(5)); await wait(350);
  eq(lastFrame().mode, 5, '雷达期间 SET_MODE(彩虹) 生效');
  await wait(1800);
  eq(lastFrame().mode, 5, '不回跳，保持在彩虹（同固件）');

  /* ---- 8. 断开与广播恢复 ---- */
  console.log('\n[8] 断开与广播恢复');
  let connEvents = [];
  wx.onBLEConnectionStateChange(function (r) { connEvents.push(r); });
  await call(wx.closeBLEConnection, { deviceId: devId });
  await wait(200);
  eq(connEvents.filter(function (c) { return !c.connected; }).length, 1,
    '断开事件异步派发（ble.disconnect 清完 state 后才到，不误触防丢弹窗）');

  let found3 = [];
  wx.onBluetoothDeviceFound(function (r) { found3 = found3.concat(r.devices); });
  await call(wx.startBluetoothDevicesDiscovery, { services: [P.SERVICE_UUID] });
  await wait(1900);
  eq(found3.length, 1, '断开后恢复广播（同固件 restartOnDisconnect），能再次被扫到');

  /* ---- 9. 5 秒周期推送（这里用 200ms 验证机制） ---- */
  console.log('\n[9] 周期状态推送');
  mock.install({ statusIntervalMs: 200 });   // 重新装一遍，只换周期
  frames = [];
  await call(wx.createBLEConnection, { deviceId: devId });
  wx.onBLECharacteristicValueChange(function (r) {
    var st = P.parseStatus(P.fromBuffer(r.value));
    if (st) frames.push(st);
  });
  await call(wx.notifyBLECharacteristicValueChange, {
    deviceId: devId, serviceId: P.SERVICE_UUID,
    characteristicId: P.STATUS_CHAR_UUID, state: true
  });
  await wait(1000);
  ok(frames.length >= 3, '不发命令也持续收到状态帧（连着时每 ' + 200 + 'ms 一帧，收到 ' + frames.length + ' 帧）');
  eq(lastFrame().mode, 5, '状态还是断开前的彩虹（RAM 状态，同 v0.1 固件）');

  await call(wx.closeBLEConnection, { deviceId: devId });   // 清掉定时器，让 node 能退出
  await wait(200);

  console.log('\n结果：' + passed + ' 通过，' + failed + ' 失败');
  process.exit(failed ? 1 : 0);
}

main().catch(function (e) {
  console.error('测试没跑完：', e);
  process.exit(1);
});
