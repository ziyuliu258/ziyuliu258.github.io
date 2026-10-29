'use strict';

(() => {
  if (window.siteStatisticsLoaded) return;
  window.siteStatisticsLoaded = true;
  const script = document.currentScript;
  const api = script && script.dataset.api;
  if (!api) return;
  let previousPath = '';
  let cached = null;
  let pending = false;
  let sequence = 0;

  const display = (values, message) => {
    ['site_uv', 'site_pv', 'page_pv'].forEach((key) => {
      const el = document.getElementById('busuanzi_value_' + key);
      if (!el) return;
      el.textContent = values ? Number(values[key]).toLocaleString() : '—';
      el.title = message || '新统计服务从启用时开始计数';
    });
  };

  async function update() {
    const url = new URL(location.href);
    const path = url.origin + url.pathname;
    if (path === previousPath && cached) {
      display(cached);
      return;
    }
    if (path === previousPath && pending) return;
    previousPath = path;
    cached = null;
    const serial = ++sequence;
    if (['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
      display(null, '本地预览不计入访问统计');
      return;
    }
    display(null, '正在获取统计数据');
    pending = true;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const headers = { 'x-bsz-referer': path };
      try {
        const identity = localStorage.getItem('bsz-id');
        if (identity) headers.Authorization = 'Bearer ' + identity;
      } catch (_) {}
      const response = await fetch(api, { method: 'POST', headers, signal: controller.signal });
      if (!response.ok) throw new Error('statistics unavailable');
      const result = await response.json();
      if (!result.success || !result.data ||
          !['site_uv', 'site_pv', 'page_pv'].every((key) =>
            Number.isFinite(result.data[key]) && result.data[key] >= 0)) {
        throw new Error('invalid statistics');
      }
      try {
        const identity = response.headers.get('Set-Bsz-Identity');
        if (identity) localStorage.setItem('bsz-id', identity);
      } catch (_) {}
      if (serial !== sequence) return;
      cached = result.data;
      display(cached);
    } catch (_) {
      if (serial === sequence) display(null, '统计暂时不可用，刷新页面后重试');
    } finally {
      clearTimeout(timer);
      if (serial === sequence) pending = false;
    }
  }
  document.addEventListener('pjax:complete', update);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', update, { once: true });
  else update();
})();
