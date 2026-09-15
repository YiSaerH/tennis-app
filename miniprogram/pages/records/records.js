// 打球记录：月历 + 筛选搜索 + 记录列表 + 穿线提醒横幅
const store = require('../../utils/store');

Page({
  data: {
    search: '',
    opp: '',          // 对手筛选，''=全部
    month: '',        // 月份筛选，''=不限（月历显示当前月）
    calDay: '',       // 点选的日期，''=不按天筛选
    banners: [],
    countText: '尚无记录',
    cal: null,
    wds: ['日', '一', '二', '三', '四', '五', '六'],
    oppRange: ['全部对手'],
    oppLabel: '全部对手',
    monthLabel: '按月筛选',
    list: []
  },

  onLoad() {
    this.render();
  },
  onShow() {
    // 从编辑页返回后刷新
    this.render();
  },

  render() {
    const st = store.getStore();

    // 穿线提醒横幅
    const banners = st.rackets
      .map(function (r) { return { id: r.id, name: r.name, info: store.stringingInfo(r) }; })
      .filter(function (x) { return x.info && x.info.due; })
      .map(function (x) { return { id: x.id, name: x.name, days: x.info.days, hours: x.info.hours }; });

    // 对手筛选选项
    const opps = st.sessions
      .map(function (s) { return s.opponent; })
      .filter(function (o, i, a) { return o && a.indexOf(o) === i; })
      .sort();

    // 列表：按日期倒序（同日按创建时间倒序）
    const q = (this.data.search || '').trim().toLowerCase();
    let arr = st.sessions.slice().sort(function (a, b) {
      if ((b.date || '') !== (a.date || '')) return (b.date || '') > (a.date || '') ? 1 : -1;
      return (b.createdAt || 0) - (a.createdAt || 0);
    });
    if (q) {
      arr = arr.filter(function (s) {
        return ((s.opponent || '') + ' ' + (s.notes || '') + ' ' + store.racketName(s.racketId)).toLowerCase().indexOf(q) >= 0;
      });
    }
    if (this.data.opp) arr = arr.filter(s => s.opponent === this.data.opp);
    if (this.data.month) arr = arr.filter(s => (s.date || '').slice(0, 7) === this.data.month);
    if (this.data.calDay) arr = arr.filter(s => s.date === this.data.calDay);

    const total = st.sessions.length, shown = arr.length;
    const countText = !total ? '尚无记录'
      : (shown < total ? '共 ' + total + ' 次 · 当前 ' + shown + ' 条' : '共 ' + total + ' 次记录');

    const list = arr.map(function (s) {
      const notes = s.notes || '';
      return {
        id: s.id,
        opponent: s.opponent || '—',
        dateStr: store.fmtDate(s.date),
        durationStr: store.fmtDuration(s.duration),
        racketName: store.racketName(s.racketId),
        costText: s.cost != null ? '💰 ¥' + s.cost : '',
        notesShort: notes ? (notes.length > 40 ? notes.slice(0, 40) + '…' : notes) : ''
      };
    });

    const m = this.data.month || store.currentMonth();
    const mp = m.split('-');
    this.setData({
      banners: banners,
      list: list,
      countText: countText,
      cal: store.buildCalendar(m, this.data.calDay),
      oppRange: ['全部对手'].concat(opps),
      oppLabel: this.data.opp || '全部对手',
      monthLabel: this.data.month ? (mp[0] + '年' + Number(mp[1]) + '月') : '按月筛选'
    });
  },

  onSearch(e) {
    this.setData({ search: e.detail.value });
    this.render();
  },
  onOppChange(e) {
    const i = +e.detail.value;
    this.setData({ opp: i === 0 ? '' : this.data.oppRange[i] });
    this.render();
  },
  onMonthChange(e) {
    this.setData({ month: e.detail.value, calDay: '' });
    this.render();
  },
  onReset() {
    this.setData({ search: '', opp: '', month: '', calDay: '' });
    this.render();
  },
  calPrev() {
    this.setData({ month: store.shiftMonth(this.data.month || store.currentMonth(), -1), calDay: '' });
    this.render();
  },
  calNext() {
    this.setData({ month: store.shiftMonth(this.data.month || store.currentMonth(), 1), calDay: '' });
    this.render();
  },
  pickDay(e) {
    const ds = e.currentTarget.dataset.ds;
    this.setData({ calDay: this.data.calDay === ds ? '' : ds });
    this.render();
  },

  addSession() {
    wx.navigateTo({ url: '/pages/session-edit/session-edit' });
  },
  editSession(e) {
    wx.navigateTo({ url: '/pages/session-edit/session-edit?id=' + e.currentTarget.dataset.id });
  },
  delSession(e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({
      title: '删除记录',
      content: '删除这条打球记录？',
      confirmText: '删除',
      confirmColor: '#b00020',
      success: (res) => {
        if (!res.confirm) return;
        store.deleteSession(id);
        this.render();
        wx.showToast({ title: '已删除', icon: 'success' });
      }
    });
  },
  goGear() {
    wx.switchTab({ url: '/pages/gear/gear' });
  }
});
