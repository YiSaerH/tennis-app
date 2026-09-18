var store = require('../../utils/store');
var presence = require('../../utils/presence');
var geogrid = require('../../utils/geogrid');
var ble = require('../../utils/ble');

/* 没拿到定位时的默认中心（北京），拿到模糊定位后会自动切到用户所在城市 */
var DEFAULT_CENTER = { latitude: 39.90, longitude: 116.41 };
var CHECKIN_MS = 2 * 60 * 60 * 1000;  // 打卡在地图上保留 2 小时

Page({
  data: {
    center: DEFAULT_CENTER,
    circles: [],
    demo: true,
    shareLocation: false,
    checkinLeft: '',
    charmName: '',
    charmConnected: false,
    radarState: ''  // '' | 'scanning' | 'found' | 'none'
  },

  onShow: function () {
    var settings = store.getSettings();
    this.setData({
      shareLocation: settings.shareLocation,
      charmName: settings.charmName
    });
    this.renderCheckin();
    if (settings.shareLocation) {
      this.startHeartbeat();
    }
    this.loadDensity();
  },

  onHide: function () {
    this.stopHeartbeat();
  },

  onUnload: function () {
    this.stopHeartbeat();
  },

  /* ---------- 定位（临时停用）----------
     模糊定位的接口权限还没在微信后台申请开通，代码包里带着这个调用
     就上传不了开发版（真机调试报 -80424）。开通后把 getLoc 恢复成真调用，
     并在 app.json 加回 requiredPrivateInfos / permission 声明（git 历史里有）。 */

  getLoc: function (cb) {
    cb({ errMsg: '定位接口暂未开通' });
  },

  /* ---------- 共享开关与心跳 ---------- */

  startHeartbeat: function () {
    this.stopHeartbeat();
    var that = this;
    this.reportSelf();
    this._hbTimer = setInterval(function () {
      that.reportSelf();
    }, presence.HEARTBEAT_MS);
  },

  stopHeartbeat: function () {
    if (this._hbTimer) {
      clearInterval(this._hbTimer);
      this._hbTimer = null;
    }
  },

  reportSelf: function () {
    var that = this;
    this.getLoc(function (err, loc) {
      if (err) return;
      that.setData({ center: loc });
      presence.report(loc.latitude, loc.longitude, presence.HEARTBEAT_TTL, function () {
        // 上报成功后刷新一次周围密度
        that.loadDensity();
      });
    });
  },

  toggleShare: function (e) {
    var that = this;
    var on = e.detail.value;
    if (!on) {
      store.updateSettings({ shareLocation: false });
      this.setData({ shareLocation: false });
      this.stopHeartbeat();
      presence.offline(function () {});
      return;
    }
    // 先显示开关，拿不到定位再回退
    this.setData({ shareLocation: true });
    this.getLoc(function (err, loc) {
      if (err) {
        that.setData({ shareLocation: false });
        wx.showModal({
          title: '需要位置权限',
          content: '开启共享需要模糊位置权限（只上传约 1 公里的网格点，不会泄露精确位置）。',
          confirmText: '去设置',
          success: function (res) {
            if (res.confirm) wx.openSetting({});
          }
        });
        return;
      }
      store.updateSettings({ shareLocation: true });
      that.setData({ center: loc });
      that.startHeartbeat();
      that.loadDensity();
      wx.showToast({ title: '已开启共享', icon: 'success' });
    });
  },

  /* ---------- 球场打卡（保留 2 小时） ---------- */

  checkin: function () {
    var that = this;
    this.getLoc(function (err, loc) {
      if (err) {
        wx.showToast({ title: '拿不到定位', icon: 'none' });
        return;
      }
      presence.checkin(loc.latitude, loc.longitude, function (res) {
        store.updateSettings({ lastCheckinAt: Date.now() });
        that.setData({ center: loc });
        that.renderCheckin();
        that.loadDensity();
        wx.showToast({ title: '已打卡，今天在球场', icon: 'success' });
      });
    });
  },

  renderCheckin: function () {
    var settings = store.getSettings();
    var left = '';
    if (settings.lastCheckinAt) {
      var ms = settings.lastCheckinAt + CHECKIN_MS - Date.now();
      if (ms > 0) {
        left = Math.ceil(ms / 60000) + ' 分钟后在图上可见';
      }
    }
    this.setData({ checkinLeft: left });
  },

  /* ---------- 密度图 ---------- */

  loadDensity: function () {
    var that = this;
    var c = this.data.center;
    presence.density(c.latitude, c.longitude, function (res) {
      that.setData({
        circles: geogrid.buildCircles(res.cells),
        demo: res.demo
      });
    });
  },

  /* ---------- 雷达互闪 ---------- */

  radarScan: function () {
    var that = this;
    if (this.data.radarState === 'scanning') return;
    this.setData({ radarState: 'scanning' });
    ble.radarScan({
      onPeer: function (peer) {
        that.setData({ radarState: 'found' });
        if (ble.isConnected()) {
          ble.sendTrigger(6);  // 让自己的饰品闪雷达灯效
        }
        wx.showToast({ title: '附近有球友！', icon: 'none' });
        setTimeout(function () {
          that.setData({ radarState: '' });
        }, 3000);
      },
      onDone: function (found) {
        if (!found) {
          that.setData({ radarState: 'none' });
          setTimeout(function () {
            that.setData({ radarState: '' });
          }, 3000);
        }
      }
    });
  },

  goCharm: function () {
    wx.navigateTo({ url: '/pages/charm/charm' });
  }
});
