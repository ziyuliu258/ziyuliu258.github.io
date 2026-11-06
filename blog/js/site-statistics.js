'use strict';

(() => {
  if (window.siteStatisticsLoaded) return;
  window.siteStatisticsLoaded = true;
  const script = document.currentScript;
  const liquidSite = (window.GLOBAL_CONFIG_SITE && GLOBAL_CONFIG_SITE.liquid) || {};
  const stats = liquidSite.stats || {};
  const api = stats.api || (script && script.dataset.api) || '';
  if (!api || stats.enable === false) return;
  const note = stats.note || 'Counting starts when the new statistics service was enabled';
  const localNote = stats.local || 'Local previews are not counted';
  const loadingNote = stats.loading || 'Loading statistics';
  const errorNote = stats.error || 'Statistics are temporarily unavailable. Refresh the page to retry';
  let previousPath = '';
  let cached = null;
  let pending = false;
  let sequence = 0;

  const display = (values, message) => {
    ['site_uv', 'site_pv', 'page_pv'].forEach((key) => {
      const el = document.getElementById('busuanzi_value_' + key);
      if (!el) return;
      el.textContent = values ? Number(values[key]).toLocaleString() : '—';
      el.title = message || note;
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
      display(null, localNote);
      return;
    }
    display(null, loadingNote);
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
      if (serial === sequence) display(null, errorNote);
    } finally {
      clearTimeout(timer);
      if (serial === sequence) pending = false;
    }
  }
  document.addEventListener('pjax:complete', update);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', update, { once: true });
  else update();
})();
