// 统计 + 数据备份（导出/导入与网页版 JSON 互通）
const store = require('../../utils/store');

// 两个横条列表默认只露前 3 条，点「展开」看全部
const FOLD_N = 3;

Page({
  data: {
    month: '',           // 'YYYY-MM'，空 = 本月
    monthLabel: '',      // 完整「2026年9月」，顶部月份选择框用
    monthShort: '',      // 只「9月」，三张月度卡片用
    curTag: '',          // 选中本月时显示「 · 本月」
    totalN: 0,
    totalTime: { n: '0', unit: '分钟' },
    totalCost: '¥0',
    monthCount: 0,
    monthTime: { n: '0', unit: '分钟' },
    monthCost: '¥0',
    opps: [],
    recent: [],
    oppsOpen: false,
    recentOpen: false,
    oppsShown: [],
    recentShown: []
  },

  onShow() {
    this.render();
  },

  render() {
    const m = this.data.month || store.currentMonth();
    const st = store.computeStats(m);
    const parts = m.split('-');
    const isCur = m === store.currentMonth();
    const maxOpp = st.maxOpp;
    const opps = st.oppArr.slice(0, 6).map(function (p) {
      return { name: p[0], c: p[1], pct: (p[1] / maxOpp * 100).toFixed(1) };
    });
    const recent = st.recent.map(function (s) {
      const dur = +s.duration || 0;
      return {
        id: s.id,
        name: s.opponent || '—',
        dur: store.fmtDuration(dur),
        pct: Math.min(100, dur / 120 * 100).toFixed(1)
      };
    });
    this.setData({
      month: m,
      monthLabel: parts[0] + '年' + Number(parts[1]) + '月',
      monthShort: Number(parts[1]) + '月',
      curTag: isCur ? ' · 本月' : '',
      totalN: st.total,
      totalTime: store.fmtHours(st.totalMin),
      totalCost: store.fmtMoney(st.totalCost),
      monthCount: st.monthCount,
      monthTime: store.fmtHours(st.monthMin),
      monthCost: store.fmtMoney(st.monthCost),
      opps: opps,
      recent: recent,
      oppsShown: this.data.oppsOpen ? opps : opps.slice(0, FOLD_N),
      recentShown: this.data.recentOpen ? recent : recent.slice(0, FOLD_N)
    });
  },

  /* ---------- 按月翻看 ---------- */
  statShift(e) {
    const delta = +e.currentTarget.dataset.d;
    this.setData({ month: store.shiftMonth(this.data.month || store.currentMonth(), delta) });
    this.render();
  },
  onMonthChange(e) {
    this.setData({ month: e.detail.value || store.currentMonth() });
    this.render();
  },
  resetMonth() {
    this.setData({ month: store.currentMonth() });
    this.render();
  },

  /* 折叠/展开（切后台再回来、导入备份后仍保持当前开合状态） */
  toggleOpps() {
    const open = !this.data.oppsOpen;
    this.setData({
      oppsOpen: open,
      oppsShown: open ? this.data.opps : this.data.opps.slice(0, FOLD_N)
    });
  },
  toggleRecent() {
    const open = !this.data.recentOpen;
    this.setData({
      recentOpen: open,
      recentShown: open ? this.data.recent : this.data.recent.slice(0, FOLD_N)
    });
  },

  /* 导出：备份 JSON 复制到剪贴板（小程序里最稳的通道，可粘贴到备忘录/微信收藏保存） */
  exportBackup() {
    const data = store.exportData();
    wx.setClipboardData({
      data: data,
      success() {
        wx.showModal({
          title: '已复制备份 JSON',
          content: '备份已复制到剪贴板。粘贴到备忘录/微信收藏即可保存；网页版右上角 ⬆️ 也能直接导入这份内容。',
          showCancel: false,
          confirmText: '好的'
        });
      }
    });
  },

  /* 导入：弹窗粘贴 JSON（基础库 2.17.1+ 支持 editable 弹窗） */
  importBackup() {
    const that = this;
    wx.showModal({
      title: '导入备份',
      editable: true,
      placeholderText: '粘贴备份 JSON（网页版 ⬇️ 导出的内容）',
      confirmText: '导入',
      confirmColor: '#2e7d32',
      success(res) {
        if (!res.confirm) return;
        const text = (res.content || '').trim();
        if (!text) return;
        try {
          store.importData(text);
          that.render();
          wx.showToast({ title: '导入成功', icon: 'success' });
        } catch (e) {
          wx.showToast({ title: '导入失败：格式不对', icon: 'none' });
        }
      }
    });
  }
});
