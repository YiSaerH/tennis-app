var store = require('../../utils/store');
var ble = require('../../utils/ble');
var proto = require('../../utils/ble-protocol');

var COLORS = [
  { hex: '#ccff00', name: '网球' },
  { hex: '#ffffff', name: '球场灯' },
  { hex: '#ff5252', name: '红土' },
  { hex: '#448aff', name: '硬地' },
  { hex: '#69f0ae', name: '草地' },
  { hex: '#e040fb', name: '夜赛' }
];

Page({
  data: {
    state: 'idle',  // 'idle' | 'scanning' | 'connected'
    devices: [],
    charmName: '',
    battery: '',
    mode: 2,
    brightness: 90,
    color: '#ccff00',
    lostAlert: true,
    modes: proto.MODES,
    colors: COLORS
  },

  onShow: function () {
    this.syncFromSettings();
    this.hookBle();
    this.setData({ state: ble.isConnected() ? 'connected' : 'idle' });
  },

  syncFromSettings: function () {
    var s = store.getSettings();
    this.setData({
      charmName: s.charmName,
      mode: s.lightMode,
      brightness: s.brightness,
      color: s.color,
      lostAlert: s.lostAlert
    });
  },

  /* 接收饰品的电量 / 状态回报，以及断连提醒 */
  hookBle: function () {
    var that = this;
    ble.onStatus(function (st) {
      that.setData({
        battery: st.battery + '%',
        mode: st.mode,
        brightness: st.brightness,
        color: st.color
      });
    });
    ble.onDisconnect(function () {
      that.setData({ state: 'idle', battery: '' });
      if (store.getSettings().lostAlert) {
        wx.showModal({
          title: '饰品已断开',
          content: '可能是距离太远或没电了，注意别把它落在球场哦。',
          showCancel: false
        });
      }
    });
  },

  /* ---------- 绑定 / 连接 ---------- */

  bindCharm: function () {
    var that = this;
    if (this.data.state === 'scanning') return;
    this.setData({ state: 'scanning' });
    ble.scanCharm(6, function (err, devices) {
      if (err) {
        that.setData({ state: 'idle' });
        wx.showModal({
          title: '搜索失败',
          content: err.errMsg || '请确认手机蓝牙已打开，且饰品电量充足。',
          showCancel: false
        });
        return;
      }
      if (!devices.length) {
        that.setData({ state: 'idle' });
        wx.showToast({ title: '附近没有发现饰品', icon: 'none' });
        return;
      }
      if (devices.length === 1) {
        that.connect(devices[0]);
        return;
      }
      wx.showActionSheet({
        itemList: devices.slice(0, 6).map(function (d) { return d.name || '未知饰品'; }),
        success: function (res) {
          that.connect(devices[res.tapIndex]);
        },
        fail: function () {
          that.setData({ state: 'idle' });
        }
      });
    });
  },

  connect: function (device) {
    var that = this;
    wx.showLoading({ title: '连接中', mask: true });
    ble.connect(device.deviceId, function (err) {
      wx.hideLoading();
      if (err) {
        that.setData({ state: 'idle' });
        wx.showToast({ title: '连接失败，再试一次', icon: 'none' });
        return;
      }
      var name = device.name || '我的饰品';
      if (!store.getSettings().charmName) {
        store.updateSettings({ charmName: name });
        that.setData({ charmName: name });
      }
      that.setData({ state: 'connected' });
      that.pushSettings();
      wx.showToast({ title: '已连接', icon: 'success' });
    });
  },

  /* 连上后把本机保存的灯效设置推给饰品 */
  pushSettings: function () {
    var s = store.getSettings();
    ble.sendMode(s.lightMode);
    setTimeout(function () { ble.sendBrightness(s.brightness); }, 150);
    setTimeout(function () { ble.sendColor(s.color); }, 300);
  },

  renameCharm: function () {
    var that = this;
    wx.showModal({
      title: '饰品昵称',
      editable: true,
      placeholderText: this.data.charmName || '我的饰品',
      success: function (res) {
        if (res.confirm && res.content) {
          store.updateSettings({ charmName: res.content });
          that.setData({ charmName: res.content });
        }
      }
    });
  },

  /* ---------- 灯效 / 亮度 / 颜色 ---------- */

  pickMode: function (e) {
    var v = +e.currentTarget.dataset.v;
    this.setData({ mode: v });
    store.updateSettings({ lightMode: v });
    ble.sendMode(v);
  },

  flash: function () {
    ble.sendTrigger(6);
  },

  onBrightDrag: function (e) {
    this.setData({ brightness: e.detail.value });
  },

  onBrightChange: function (e) {
    var v = e.detail.value;
    this.setData({ brightness: v });
    store.updateSettings({ brightness: v });
    ble.sendBrightness(v);
  },

  pickColor: function (e) {
    var hex = e.currentTarget.dataset.hex;
    this.setData({ color: hex });
    store.updateSettings({ color: hex });
    ble.sendColor(hex);
  },

  toggleLostAlert: function (e) {
    store.updateSettings({ lostAlert: e.detail.value });
    this.setData({ lostAlert: e.detail.value });
  },

  unbind: function () {
    var that = this;
    wx.showModal({
      title: '断开饰品',
      content: '断开后灯效设置仍会保留，下次连接自动同步。',
      success: function (res) {
        if (res.confirm) {
          ble.disconnect();
          that.setData({ state: 'idle', battery: '' });
        }
      }
    });
  }
});
