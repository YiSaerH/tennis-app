// 我的拍子：球拍参数卡片 + 记录换线
const store = require('../../utils/store');

Page({
  data: {
    list: [],
    countText: '还没有添加球拍'
  },

  onShow() {
    this.render();
  },

  render() {
    const st = store.getStore();
    const arr = st.rackets.slice().sort(function (a, b) { return (a.createdAt || 0) - (b.createdAt || 0); });
    const list = arr.map(function (r) {
      const uses = st.sessions.filter(function (s) { return s.racketId === r.id; }).length;
      const info = store.stringingInfo(r);
      return {
        id: r.id,
        name: r.name,
        string: r.string || '',
        uses: uses,
        weight: r.weight || '',
        tension: r.tension ? String(r.tension) : '',
        tensionPair: r.tension ? String(r.tension).indexOf('/') >= 0 : false,
        swing: r.swing || '',
        infoText: info ? '🏸 上次穿线 ' + info.days + ' 天前 / 已打 ' + info.hours + ' 小时' : '',
        infoDue: !!(info && info.due),
        notes: r.notes || ''
      };
    });
    this.setData({
      list: list,
      countText: st.rackets.length ? st.rackets.length + ' 把球拍' : '还没有添加球拍'
    });
  },

  addGear() {
    wx.navigateTo({ url: '/pages/gear-edit/gear-edit' });
  },
  editGear(e) {
    wx.navigateTo({ url: '/pages/gear-edit/gear-edit?id=' + e.currentTarget.dataset.id });
  },
  restring(e) {
    const id = e.currentTarget.dataset.id;
    const r = store.getStore().rackets.find(function (x) { return x.id === id; });
    if (!r) return;
    wx.showModal({
      title: '记录换线',
      content: '把「' + r.name + '」的穿线日期记为今天？\n（换上新线后点这个，会重新开始计时）',
      success: (res) => {
        if (!res.confirm) return;
        store.restringRacket(id);
        this.render();
        wx.showToast({ title: '已记录换线 🏸', icon: 'none' });
      }
    });
  },
  delGear(e) {
    const id = e.currentTarget.dataset.id;
    const uses = store.getStore().sessions.filter(function (s) { return s.racketId === id; }).length;
    const msg = uses
      ? '这把拍子关联了 ' + uses + ' 条打球记录，删除后记录会保留但不再显示拍子。确定删除？'
      : '删除这把球拍？';
    wx.showModal({
      title: '删除球拍',
      content: msg,
      confirmText: '删除',
      confirmColor: '#b00020',
      success: (res) => {
        if (!res.confirm) return;
        store.deleteRacket(id);
        this.render();
        wx.showToast({ title: '已删除', icon: 'success' });
      }
    });
  }
});
