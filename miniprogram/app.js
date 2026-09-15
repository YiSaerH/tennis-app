const store = require('./utils/store');
const presence = require('./utils/presence');

App({
  onLaunch() {
    store.load();
    /* 开通了云开发就自动启用球友地图的云端通道；没开通则球友页走演示数据 */
    presence.initCloud();
  }
});
