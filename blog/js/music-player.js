'use strict';

(() => {
  if (window.musicPageLoaded) return;
  window.musicPageLoaded = true;
  const assetRoot = GLOBAL_CONFIG.root;
  let tracks = [];
  let current = null;
  let statusText = '正在加载歌单…';
  let pageRoot = null;

  const icons = {
    previous: '<path d="M5 5h2v14H5zM18 5v14L8 12z"/>',
    next: '<path d="M17 5h2v14h-2zM6 5v14l10-7z"/>',
    play: '<path d="M7 4.5v15L19 12z"/>',
    pause: '<path d="M6.5 5h4v14h-4zM13.5 5h4v14h-4z"/>',
    list: '<path d="M4 6h11v1.8H4zm0 5.1h11v1.8H4zm0 5.1h11v1.8H4zM17 6h3v1.8h-3zm0 5.1h3v1.8h-3zm0 5.1h3v1.8h-3z"/>'
  };
  function setIcon(button, name) {
    if (button.dataset.icon === name) return;
    button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' + icons[name] + '</svg>';
    button.dataset.icon = name;
  }
  function setTransportIcons(root, attribute) {
    for (const name of ['previous', 'next']) {
      setIcon(root.querySelector('[' + attribute + '="' + name + '"]'), name);
    }
  }

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
      <div class="music-dock-lyric" data-dock-lyric hidden></div>
      <div class="music-dock-controls">
        <button type="button" data-action="previous" aria-label="上一首" title="上一首">⏮</button>
        <button class="music-dock-play" type="button" data-action="toggle" aria-label="播放" title="播放">▶</button>
        <button type="button" data-action="next" aria-label="下一首" title="下一首">⏭</button>
        <label class="music-dock-volume">Volume <input data-dock-volume type="range" min="0" max="1" step="0.01" value="1" aria-label="Volume"></label>
      </div>
      <div class="music-dock-progress">
        <span data-dock-elapsed>0:00</span>
        <input data-dock-seek type="range" min="0" max="1000" value="0" aria-label="播放进度">
        <span data-dock-duration>0:00</span>
        <button class="music-dock-list" type="button" data-action="playlist" aria-label="Playlist" title="Playlist" aria-expanded="false"></button>
      </div>
      <audio preload="none"></audio>
      <p class="music-dock-status" data-dock-status role="status"></p>
    </div>
    <div class="music-dock-playlist" data-dock-playlist hidden>
      <ol data-dock-list></ol>
    </div>`;
  document.body.appendChild(dock);
  const audio = dock.querySelector('audio');
  const findDock = (name) => dock.querySelector('[data-dock-' + name + ']');
  const findPage = (name) => pageRoot && pageRoot.querySelector('[data-music-' + name + ']');
  setTransportIcons(dock, 'data-action');
  setIcon(dock.querySelector('[data-action="playlist"]'), 'list');
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
  const lyricLines = new Map();
  let lyricIndex = -1;
  let renderedLyricId = null;
  let followLyrics = true;
  let followTimer = 0;
  function parseLrc(text) {
    const lines = [];
    if (!text) return lines;
    for (const raw of String(text).split(/\r?\n/)) {
      const stamps = [...raw.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
      if (!stamps.length) continue;
      const content = raw.replace(/\[[^\]]+\]/g, '').replace(/\u00a0/g, ' ').trim();
      if (!content || content === '纯音乐，请欣赏' || content === '纯音乐，请欣赏。') continue;
      for (const stamp of stamps) lines.push({ time: Number(stamp[1]) * 60 + Number(stamp[2]), text: content });
    }
    lines.sort((a, b) => a.time - b.time);
    return lines;
  }
  function linesFor(track) {
    if (!track) return [];
    if (!lyricLines.has(track.id)) lyricLines.set(track.id, parseLrc(track.lyric || ''));
    return lyricLines.get(track.id);
  }
  function indexAt(lines, seconds) {
    let index = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].time <= seconds + 0.05) index = i;
      else break;
    }
    return index;
  }
  function holdLyricFollow() {
    const view = findPage('lyrics-view');
    followLyrics = false;
    if (view) view.style.scrollBehavior = 'auto';
    clearTimeout(followTimer);
    followTimer = setTimeout(() => {
      followLyrics = true;
      if (view) view.style.scrollBehavior = 'smooth';
      lyricIndex = -1;
      syncLyrics();
    }, 2500);
  }
  function syncLyrics() {
    const lines = linesFor(current);
    const index = indexAt(lines, audio.currentTime || 0);
    const slot = findDock('lyric');
    const trackKey = current ? String(current.id) : '';
    if (!lines.length) {
      slot.hidden = true;
      slot.replaceChildren();
      delete slot.dataset.index;
      delete slot.dataset.track;
    } else if (slot.dataset.index !== String(index) || slot.dataset.track !== trackKey) {
      slot.hidden = false;
      slot.dataset.index = String(index);
      slot.dataset.track = trackKey;
      slot.replaceChildren();
      const currentLine = document.createElement('span');
      const shown = index >= 0 ? lines[index] : lines[0];
      currentLine.textContent = shown.text;
      if (index < 0) currentLine.className = 'is-upcoming';
      slot.append(currentLine);
      const upcoming = index >= 0 ? lines[index + 1] : null;
      if (upcoming) {
        const next = document.createElement('small');
        next.textContent = upcoming.text;
        slot.append(next);
      }
    }
    const box = findPage('lyrics');
    const view = findPage('lyrics-view');
    if (!box || !view) return;
    if (!lines.length) {
      box.hidden = true;
      renderedLyricId = null;
      view.replaceChildren();
      return;
    }
    box.hidden = false;
    if (renderedLyricId !== current.id) {
      renderedLyricId = current.id;
      lyricIndex = -1;
      followLyrics = true;
      view.style.scrollBehavior = 'auto';
      const fragment = document.createDocumentFragment();
      lines.forEach((line, i) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'music-lyric-line';
        button.dataset.index = String(i);
        button.textContent = line.text;
        button.addEventListener('click', () => {
          audio.currentTime = line.time;
          followLyrics = true;
          view.style.scrollBehavior = 'smooth';
        });
        fragment.append(button);
      });
      view.replaceChildren(fragment);
      view.scrollTop = 0;
    }
    if (index === lyricIndex) return;
    lyricIndex = index;
    view.querySelectorAll('.music-lyric-line').forEach((button, i) => {
      button.classList.toggle('is-active', i === index);
      button.classList.toggle('is-past', index >= 0 && i < index);
    });
    if (!followLyrics || index < 0) return;
    const active = view.querySelector('.music-lyric-line.is-active');
    if (!active) return;
    view.scrollTo({
      top: Math.max(0, active.offsetTop - (view.clientHeight - active.offsetHeight) / 2),
      behavior: view.style.scrollBehavior === 'auto' ? 'auto' : 'smooth'
    });
    view.style.scrollBehavior = 'smooth';
  }
  function renderDockList() {
    const list = dock.querySelector('[data-dock-list]');
    list.replaceChildren();
    tracks.forEach((track, index) => {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.trackId = String(track.id);
      button.disabled = !track.available;
      if (current && current.id === track.id) button.classList.add('is-current');
      const number = document.createElement('span');
      number.textContent = String(index + 1).padStart(2, '0');
      const name = document.createElement('strong');
      name.textContent = track.name;
      const artist = document.createElement('small');
      artist.textContent = track.artist;
      button.append(number, name, artist);
      item.append(button);
      list.append(item);
    });
    const currentButton = list.querySelector('.is-current');
    if (currentButton) dock.querySelector('[data-dock-playlist]').scrollTop = Math.max(0, currentButton.offsetTop - 24);
  }
  function setPlaylistOpen(open) {
    dock.classList.toggle('is-playlist-open', open);
    dock.querySelector('[data-dock-playlist]').hidden = !open;
    dock.querySelector('[data-action="playlist"]').setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) renderDockList();
  }
  function update() {
    const playing = !audio.paused;
    dock.querySelectorAll('[data-action="toggle"]').forEach((button) => {
      setIcon(button, playing ? 'pause' : 'play');
      button.setAttribute('aria-label', playing ? '暂停' : '播放');
      button.title = playing ? '暂停' : '播放';
    });
    findDock('status').textContent = statusText;
    findDock('elapsed').textContent = time(audio.currentTime);
    findDock('duration').textContent = time(audio.duration);
    findDock('seek').value = Number.isFinite(audio.duration) && audio.duration ? Math.round(audio.currentTime / audio.duration * 1000) : 0;
    findDock('volume').value = audio.muted ? 0 : audio.volume;
    if (dock.classList.contains('is-playlist-open')) {
      dock.querySelectorAll('[data-track-id]').forEach((button) => {
        button.classList.toggle('is-current', current && button.dataset.trackId === String(current.id));
      });
    }
    syncLyrics();
    if (!pageRoot || !pageRoot.isConnected) return;
    const button = pageRoot.querySelector('[data-music-action="toggle"]');
    setIcon(button, playing ? 'pause' : 'play');
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
    if (!button || !dock.contains(button)) return;
    if (button.classList.contains('music-dock-launcher')) {
      dock.classList.remove('is-collapsed');
      return;
    }
    if (button.dataset.action === 'collapse') {
      setPlaylistOpen(false);
      dock.classList.add('is-collapsed');
      return;
    }
    if (button.dataset.action === 'playlist') {
      setPlaylistOpen(!dock.classList.contains('is-playlist-open'));
      return;
    }
    if (button.dataset.trackId) {
      const track = tracks.find((item) => String(item.id) === button.dataset.trackId);
      if (track && track.available) {
        select(track, true);
        setPlaylistOpen(false);
      }
      return;
    }
    action(button.dataset.action);
  });
  document.addEventListener('click', (event) => {
    if (!dock.classList.contains('is-playlist-open') || dock.contains(event.target)) return;
    setPlaylistOpen(false);
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
    renderedLyricId = null;
    lyricIndex = -1;
    const root = pageRoot;
    setTransportIcons(root, 'data-music-action');
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
    const lyricView = findPage('lyrics-view');
    if (lyricView) {
      lyricView.addEventListener('wheel', holdLyricFollow, { passive: true });
      lyricView.addEventListener('pointerdown', holdLyricFollow);
      lyricView.addEventListener('touchstart', holdLyricFollow, { passive: true });
    }
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
      li.append(number, info);
      list.append(li);
    });
    update();
  }
  let playlist = null;
  document.addEventListener('pjax:complete', initPage);
  initPage();
  let refreshInFlight = false;
  async function refreshPlaylist() {
    if (refreshInFlight) return;
    refreshInFlight = true;
    try {
      const response = await fetch(assetRoot + 'music/playlist.json', { cache: 'no-store' });
      if (!response.ok) throw new Error('playlist unavailable');
      const data = await response.json();
      if (!Array.isArray(data.tracks)) throw new Error('invalid playlist');
      const changed = !playlist || JSON.stringify(data) !== JSON.stringify(playlist);
      playlist = data;
      tracks = data.tracks;
      if (changed) {
        lyricLines.clear();
        renderedLyricId = null;
        lyricIndex = -1;
        renderPage(data);
        if (dock.classList.contains('is-playlist-open')) renderDockList();
      }
      if (!current) {
        const first = tracks.find((track) => track.available);
        if (first) select(first, false);
        else setStatus('当前歌单暂无可直接播放的歌曲，请在网易云收听。');
      }
    } catch (_) {
      if (!playlist) setStatus('歌单加载失败，请稍后刷新页面重试。');
    } finally {
      refreshInFlight = false;
    }
  }
  refreshPlaylist();
  setInterval(() => { if (!document.hidden) refreshPlaylist(); }, 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshPlaylist(); });
})();
