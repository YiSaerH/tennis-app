// 添加 / 编辑球拍
const store = require('../../utils/store');

Page({
  data: {
    id: '',
    name: '',
    weight: '',
    tension: '',
    swing: '',
    string: '',
    strung: '',
    notes: '',
    editing: false
  },

  onLoad(options) {
    if (options.id) {
      const r = store.getStore().rackets.find(function (x) { return x.id === options.id; });
      if (r) {
        this.setData({
          id: r.id,
          name: r.name || '',
          weight: r.weight ? String(r.weight) : '',
          tension: r.tension ? String(r.tension) : '',
          swing: r.swing ? String(r.swing) : '',
          string: r.string || '',
          strung: r.strung || '',
          notes: r.notes || '',
          editing: true
        });
      }
      wx.setNavigationBarTitle({ title: '编辑球拍' });
    }
  },

  onName(e) { this.setData({ name: e.detail.value }); },
  onWeight(e) { this.setData({ weight: e.detail.value }); },
  onTension(e) { this.setData({ tension: e.detail.value }); },
  onSwing(e) { this.setData({ swing: e.detail.value }); },
  onString(e) { this.setData({ string: e.detail.value }); },
  onStrung(e) { this.setData({ strung: e.detail.value }); },
  clearStrung() { this.setData({ strung: '' }); },
  onNotes(e) { this.setData({ notes: e.detail.value }); },

  goBack() { wx.navigateBack(); },

  save() {
    const name = (this.data.name || '').trim();
    if (!name) return wx.showToast({ title: '请填写球拍名称', icon: 'none' });

    // 线磅数：单个数字（如 55），或 横/竖 两个数字（如 46/48）
    const tension = (this.data.tension || '').trim().replace(/／/g, '/').replace(/\s+/g, '');
    if (tension && !/^\d+(\.\d+)?(\/\d+(\.\d+)?)?$/.test(tension)) {
      return wx.showToast({ title: '线磅数格式：如 55 或 46/48', icon: 'none' });
    }

    const id = this.data.id;
    const old = id
      ? store.getStore().rackets.find(function (x) { return x.id === id; })
      : null;

    store.upsertRacket({
      id: id || undefined,
      name: name,
      weight: parseInt(this.data.weight) || null,
      tension: tension || null,
      swing: parseInt(this.data.swing) || null,
      string: (this.data.string || '').trim(),
      strung: this.data.strung || null,
      notes: (this.data.notes || '').trim(),
      createdAt: old ? (old.createdAt || Date.now()) : undefined
    });

    wx.showToast({ title: id ? '已更新球拍' : '球拍已添加 🏸', icon: 'none' });
    setTimeout(function () { wx.navigateBack(); }, 350);
  }
});
