// 添加 / 编辑打球记录
const store = require('../../utils/store');

Page({
  data: {
    id: '',
    date: '',
    opponent: '',
    duration: '',
    notes: '',
    racketIndex: 0,
    racketNames: [],  // picker 选项：['不记录', ...拍子名]
    rackets: [],      // [{id, name}]，racketIndex-1 对应
    chips: [],        // 之前打过的对手，点一下快速填入（网页版用 datalist）
    editing: false
  },

  onLoad(options) {
    const st = store.getStore();
    const rackets = st.rackets.map(function (r) { return { id: r.id, name: r.name }; });
    const names = ['不记录'].concat(rackets.map(function (r) { return r.name; }));

    const seen = [];
    st.sessions.forEach(function (s) {
      if (s.opponent && seen.indexOf(s.opponent) < 0) seen.push(s.opponent);
    });

    const data = {
      date: store.todayStr(),
      racketNames: names,
      rackets: rackets,
      chips: seen.slice(0, 12)
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
  onRacket(e) { this.setData({ racketIndex: +e.detail.value }); },
  onNotes(e) { this.setData({ notes: e.detail.value }); },

  goBack() { wx.navigateBack(); },

  save() {
    const opponent = (this.data.opponent || '').trim();
    const duration = parseInt(this.data.duration) || 0;
    if (!this.data.date) return wx.showToast({ title: '请选择日期', icon: 'none' });
    if (!opponent) return wx.showToast({ title: '请填写对手', icon: 'none' });
    if (duration <= 0) return wx.showToast({ title: '请填写时长（分钟）', icon: 'none' });

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
      racketId: ri > 0 && this.data.rackets[ri - 1] ? this.data.rackets[ri - 1].id : '',
      notes: (this.data.notes || '').trim(),
      createdAt: old ? (old.createdAt || Date.now()) : undefined
    });

    wx.showToast({ title: id ? '已更新记录' : '记录已保存 🎾', icon: 'none' });
    setTimeout(function () { wx.navigateBack(); }, 350);
  }
});
