// 添加 / 编辑打球记录
const store = require('../../utils/store');

Page({
  data: {
    id: '',
    date: '',
    opponent: '',
    duration: '',
    cost: '',
    notes: '',
    racketIndex: 0,
    racketNames: [],  // picker 选项：['不记录', ...拍子名]
    rackets: [],      // [{id, name}]，racketIndex-1 对应
    chips: [],        // 对手库里的对手，点一下快速填入（网页版用 datalist）
    oppOpen: false,   // 管理对手弹层
    oppRows: [],      // 弹层里的对手行：[{name, cnt}]
    editing: false
  },

  onLoad(options) {
    const st = store.getStore();
    const rackets = st.rackets.map(function (r) { return { id: r.id, name: r.name }; });
    const names = ['不记录'].concat(rackets.map(function (r) { return r.name; }));

    const data = {
      date: store.todayStr(),
      racketNames: names,
      rackets: rackets,
      chips: st.opponents.slice(0, 12)
    };

    if (options.id) {
      const s = st.sessions.find(function (x) { return x.id === options.id; });
      if (s) {
        let ri = 0;
        rackets.forEach(function (r, i) { if (r.id === s.racketId) ri = i + 1; });
        Object.assign(data, {
          id: s.id,
          date: s.date || store.todayStr(),
          opponent: s.opponent || '',
          duration: s.duration ? String(s.duration) : '',
          cost: s.cost != null ? String(s.cost) : '',
          racketIndex: ri,
          notes: s.notes || '',
          editing: true
        });
      }
      wx.setNavigationBarTitle({ title: '编辑打球记录' });
    }
    this.setData(data);
  },

  onDate(e) { this.setData({ date: e.detail.value }); },
  onOpponent(e) { this.setData({ opponent: e.detail.value }); },
  pickChip(e) { this.setData({ opponent: e.currentTarget.dataset.v }); },
  onDuration(e) { this.setData({ duration: e.detail.value }); },
  onCost(e) { this.setData({ cost: e.detail.value }); },
  onRacket(e) { this.setData({ racketIndex: +e.detail.value }); },
  onNotes(e) { this.setData({ notes: e.detail.value }); },

  /* ---------- 管理对手 ---------- */
  buildOppRows() {
    const st = store.getStore();
    return st.opponents.map(function (o) {
      const n = st.sessions.filter(function (s) { return s.opponent === o; }).length;
      return { name: o, cnt: n ? '打过 ' + n + ' 次' : '还没打过' };
    });
  },
  openOppManager() {
    this.setData({ oppOpen: true, oppRows: this.buildOppRows() });
  },
  closeOppManager() {
    this.setData({ oppOpen: false });
  },
  noop() {},
  delOpponent(e) {
    const that = this;
    const name = e.currentTarget.dataset.name;
    const n = store.getStore().sessions.filter(function (s) { return s.opponent === name; }).length;
    wx.showModal({
      title: '移除对手',
      content: n
        ? '把「' + name + '」从候选名单移除？\n（' + n + ' 条历史记录会保留，不受影响）'
        : '把「' + name + '」从候选名单移除？',
      confirmText: '移除',
      confirmColor: '#b00020',
      success(res) {
        if (!res.confirm) return;
        store.deleteOpponent(name);
        that.setData({
          oppRows: that.buildOppRows(),
          chips: store.getStore().opponents.slice(0, 12)
        });
        wx.showToast({ title: '已从候选名单移除', icon: 'none' });
      }
    });
  },

  goBack() { wx.navigateBack(); },

  save() {
    const opponent = (this.data.opponent || '').trim();
    const duration = parseInt(this.data.duration) || 0;
    if (!this.data.date) return wx.showToast({ title: '请选择日期', icon: 'none' });
    if (!opponent) return wx.showToast({ title: '请填写对手', icon: 'none' });
    if (duration <= 0) return wx.showToast({ title: '请填写时长（分钟）', icon: 'none' });

    // 场地费：可不填；填了就得是 0 或正数，保留两位小数
    const costRaw = (this.data.cost || '').trim();
    let cost = null;
    if (costRaw !== '') {
      cost = parseFloat(costRaw);
      if (isNaN(cost) || cost < 0) return wx.showToast({ title: '场地费请填 0 或正数（元）', icon: 'none' });
      cost = Math.round(cost * 100) / 100;
    }

    const id = this.data.id;
    const ri = this.data.racketIndex;
    const old = id
      ? store.getStore().sessions.find(function (x) { return x.id === id; })
      : null;

    store.upsertSession({
      id: id || undefined,
      date: this.data.date,
      opponent: opponent,
      duration: duration,
      cost: cost,
      racketId: ri > 0 && this.data.rackets[ri - 1] ? this.data.rackets[ri - 1].id : '',
      notes: (this.data.notes || '').trim(),
      createdAt: old ? (old.createdAt || Date.now()) : undefined
    });

    wx.showToast({ title: id ? '已更新记录' : '记录已保存 🎾', icon: 'none' });
    setTimeout(function () { wx.navigateBack(); }, 350);
  }
});
