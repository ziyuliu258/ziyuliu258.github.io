'use strict';

(() => {
  if (window.musicPageLoaded) return;
  window.musicPageLoaded = true;
  const assetRoot = GLOBAL_CONFIG.root;
  let tracks = [];
  let current = null;
  let statusText = '正在加载歌单…';
  let pageRoot = null;

  const dock = document.createElement('aside');
  dock.id = 'music-dock';
  dock.className = 'music-dock';
  dock.setAttribute('aria-label', '全局音乐播放器');
  dock.innerHTML = `
    <button class="music-dock-launcher" type="button" aria-label="展开音乐播放器" title="展开音乐播放器">♫</button>
    <div class="music-dock-body">
      <div class="music-dock-header">
        <div class="music-dock-cover music-cover" aria-hidden="true"><span>♫</span><img data-dock-cover alt="" referrerpolicy="no-referrer" hidden></div>
        <div class="music-dock-info">
          <a data-dock-track></a>
          <small data-dock-artist>正在加载歌单…</small>
        </div>
        <button class="music-dock-collapse" type="button" data-action="collapse" aria-label="收起音乐播放器" title="收起">×</button>
      </div>
      <div class="music-dock-controls">
        <button type="button" data-action="previous" aria-label="上一首" title="上一首">⏮</button>
        <button class="music-dock-play" type="button" data-action="toggle" aria-label="播放" title="播放">▶</button>
        <button type="button" data-action="next" aria-label="下一首" title="下一首">⏭</button>
        <label class="music-dock-volume">音量 <input data-dock-volume type="range" min="0" max="1" step="0.01" value="1" aria-label="音量"></label>
      </div>
      <div class="music-dock-progress">
        <span data-dock-elapsed>0:00</span>
        <input data-dock-seek type="range" min="0" max="1000" value="0" aria-label="播放进度">
        <span data-dock-duration>0:00</span>
      </div>
      <audio preload="none"></audio>
      <p class="music-dock-status" data-dock-status role="status"></p>
    </div>`;
  document.body.appendChild(dock);
  const audio = dock.querySelector('audio');
  const findDock = (name) => dock.querySelector('[data-dock-' + name + ']');
  const findPage = (name) => pageRoot && pageRoot.querySelector('[data-music-' + name + ']');
  findDock('track').href = assetRoot + 'music/';
  findDock('track').textContent = '音乐';

  function cover(img, url) {
    if (!img) return;
    img.hidden = !url || img.dataset.failed === url;
    if (!url) img.removeAttribute('src');
    else if (img.getAttribute('src') !== url) img.src = url;
  }
  dock.addEventListener('error', (event) => {
    if (event.target.tagName === 'IMG') {
      event.target.dataset.failed = event.target.getAttribute('src');
      event.target.hidden = true;
    }
  }, true);
  function time(seconds) {
    if (!Number.isFinite(seconds)) return '0:00';
    seconds = Math.floor(seconds);
    return Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
  }
  function update() {
    const playing = !audio.paused;
    dock.querySelectorAll('[data-action="toggle"]').forEach((button) => {
      button.textContent = playing ? '❚❚' : '▶';
      button.setAttribute('aria-label', playing ? '暂停' : '播放');
      button.title = playing ? '暂停' : '播放';
    });
    findDock('status').textContent = statusText;
    findDock('elapsed').textContent = time(audio.currentTime);
    findDock('duration').textContent = time(audio.duration);
    findDock('seek').value = Number.isFinite(audio.duration) && audio.duration ? Math.round(audio.currentTime / audio.duration * 1000) : 0;
    findDock('volume').value = audio.muted ? 0 : audio.volume;
    if (!pageRoot || !pageRoot.isConnected) return;
    const button = pageRoot.querySelector('[data-music-action="toggle"]');
    button.textContent = playing ? '❚❚' : '▶';
    button.setAttribute('aria-label', playing ? '暂停' : '播放');
    findPage('track').textContent = current ? current.name : '请选择歌曲';
    findPage('artist').textContent = current ? current.artist : '';
    findPage('status').textContent = statusText;
    cover(findPage('cover'), current && current.cover);
    findPage('elapsed').textContent = time(audio.currentTime);
    findPage('duration').textContent = time(audio.duration);
    findPage('seek').value = Number.isFinite(audio.duration) && audio.duration ? Math.round(audio.currentTime / audio.duration * 1000) : 0;
    findPage('volume').value = audio.muted ? 0 : audio.volume;
    pageRoot.querySelectorAll('.music-tracks li').forEach((li) => li.classList.toggle('is-current', current && li.dataset.id === String(current.id)));
  }
  function setStatus(message) { statusText = message; update(); }
  function play() {
    if (!current) return;
    audio.play().catch(() => setStatus('暂时无法播放，请在网易云收听。'));
  }
  function select(track, shouldPlay) {
    if (!track) return;
    const changed = !current || current.id !== track.id;
    current = track;
    findDock('track').textContent = track.name;
    findDock('artist').textContent = track.artist;
    cover(findDock('cover'), track.cover);
    if (changed) audio.src = 'https://music.163.com/song/media/outer/url?id=' + encodeURIComponent(track.id) + '.mp3';
    setStatus(track.preview ? '此曲仅提供试听。' : '');
    if (shouldPlay) play();
  }
  function advance(direction, shouldPlay = true) {
    const playable = tracks.filter((track) => track.available);
    if (!playable.length) return;
    const index = playable.findIndex((track) => current && track.id === current.id);
    select(playable[(index + direction + playable.length) % playable.length], shouldPlay);
  }
  function action(name) {
    if (name === 'toggle') {
      if (audio.paused) play();
      else audio.pause();
    } else if (name === 'previous') advance(-1);
    else if (name === 'next') advance(1);
  }
  dock.addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.classList.contains('music-dock-launcher')) dock.classList.remove('is-collapsed');
    else if (button.dataset.action === 'collapse') dock.classList.add('is-collapsed');
    else action(button.dataset.action);
  });
  findDock('seek').addEventListener('input', (event) => {
    if (Number.isFinite(audio.duration)) audio.currentTime = audio.duration * Number(event.target.value) / 1000;
  });
  findDock('volume').addEventListener('input', (event) => {
    audio.muted = false;
    audio.volume = Number(event.target.value);
  });
  ['play', 'pause', 'timeupdate', 'durationchange', 'volumechange'].forEach((event) => audio.addEventListener(event, update));
  audio.addEventListener('ended', () => advance(1));
  audio.addEventListener('error', () => { if (current) setStatus('这首歌暂时无法播放，请在网易云收听。'); });

  function initPage() {
    pageRoot = document.getElementById('music-library');
    if (!pageRoot || pageRoot.dataset.initialized) return;
    pageRoot.dataset.initialized = 'true';
    const root = pageRoot;
    const pageCover = document.createElement('img');
    pageCover.setAttribute('data-music-cover', '');
    pageCover.alt = '';
    pageCover.referrerPolicy = 'no-referrer';
    pageCover.hidden = true;
    root.querySelector('.music-cover').appendChild(pageCover);
    root.addEventListener('click', (event) => {
      const button = event.target.closest('[data-music-action]');
      if (button) action(button.dataset.musicAction);
    });
    root.addEventListener('error', (event) => {
      if (event.target.tagName === 'IMG') {
        event.target.dataset.failed = event.target.getAttribute('src');
        event.target.hidden = true;
      }
    }, true);
    findPage('seek').addEventListener('input', (event) => {
      if (Number.isFinite(audio.duration)) audio.currentTime = audio.duration * Number(event.target.value) / 1000;
    });
    findPage('volume').addEventListener('input', (event) => {
      audio.muted = false;
      audio.volume = Number(event.target.value);
    });
    if (playlist) renderPage(playlist);
    update();
  }
  function renderPage(data) {
    if (!pageRoot || !pageRoot.isConnected) return;
    findPage('title').textContent = data.name;
    findPage('playlist-link').href = data.url;
    const list = findPage('tracks');
    list.replaceChildren();
    data.tracks.forEach((track, index) => {
      const li = document.createElement('li');
      li.dataset.id = track.id;
      const number = document.createElement('span');
      number.className = 'music-track-number';
      number.textContent = String(index + 1).padStart(2, '0');
      const info = document.createElement(track.available ? 'button' : 'div');
      info.className = 'music-track-info';
      if (track.available) {
        info.type = 'button';
        info.addEventListener('click', () => select(track, true));
      }
      const name = document.createElement('span');
      name.className = 'music-track-name';
      name.textContent = track.name;
      const artist = document.createElement('small');
      artist.textContent = track.artist;
      info.append(name, artist);
      const link = document.createElement('a');
      link.href = 'https://music.163.com/song?id=' + encodeURIComponent(track.id);
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = track.available ? '网易云 ↗' : '网易云收听 ↗';
      li.append(number, info, link);
      list.append(li);
    });
    update();
  }
  let playlist = null;
  document.addEventListener('pjax:complete', initPage);
  initPage();
  fetch(assetRoot + 'music/playlist.json', { cache: 'no-store' })
    .then((response) => { if (!response.ok) throw new Error('playlist unavailable'); return response.json(); })
    .then((data) => {
      if (!Array.isArray(data.tracks)) throw new Error('invalid playlist');
      playlist = data;
      tracks = data.tracks;
      renderPage(data);
      const first = tracks.find((track) => track.available);
      if (first) select(first, false);
      else setStatus('当前歌单暂无可直接播放的歌曲，请在网易云收听。');
    })
    .catch(() => {
      setStatus('歌单加载失败，请稍后刷新页面重试。');
    });
})();
