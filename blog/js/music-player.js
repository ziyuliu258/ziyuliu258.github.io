'use strict';

(() => {
  if (window.musicPageLoaded) return;
  window.musicPageLoaded = true;
  let currentAudio;
  let generation = 0;
  let playerModule;

  function leave() {
    generation++;
    if (currentAudio) currentAudio.pause();
    currentAudio = null;
  }

  async function init() {
    const root = document.getElementById('music-library');
    if (!root || root.dataset.initialized) return;
    root.dataset.initialized = 'true';
    const serial = ++generation;
    const find = (name) => root.querySelector('[data-music-' + name + ']');
    const audio = root.querySelector('audio');
    const player = root.querySelector('audio-player');
    currentAudio = audio;
    const status = find('status');
    const assetRoot = GLOBAL_CONFIG.root;
    if (!document.getElementById('music-player-style')) {
      const style = document.createElement('link');
      style.id = 'music-player-style';
      style.rel = 'stylesheet';
      style.href = assetRoot + 'vendor/videojs-10.2.0/audio.css';
      document.head.appendChild(style);
    }
    playerModule ||= import(assetRoot + 'vendor/videojs-10.2.0/audio.js');
    playerModule.then(() => { if (root.isConnected) audio.controls = false; }).catch(() => {});

    try {
      const response = await fetch(assetRoot + 'music/playlist.json', { cache: 'no-store' });
      if (!response.ok) throw new Error('playlist unavailable');
      const playlist = await response.json();
      if (!Array.isArray(playlist.tracks)) throw new Error('invalid playlist');
      if (!root.isConnected || serial !== generation) return;
      find('title').textContent = playlist.name;
      find('summary').textContent = playlist.tracks.length + ' 首 · 网易云音乐';
      find('playlist-link').href = playlist.url;
      const list = find('tracks');
      let selected = null;
      function select(track, play) {
        selected = track;
        find('track').textContent = track.name;
        find('artist').textContent = track.artist;
        player.setAttribute('content-title', track.name);
        audio.src = 'https://music.163.com/song/media/outer/url?id=' + encodeURIComponent(track.id) + '.mp3';
        list.querySelectorAll('li').forEach((li) => li.classList.toggle('is-current', li.dataset.id === String(track.id)));
        status.textContent = track.preview ? '此曲仅提供试听。' : '点击播放开始收听。';
        if (play) audio.play().catch(() => { status.textContent = '暂时无法播放，请在网易云收听。'; });
      }
      playlist.tracks.forEach((track, index) => {
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
      const first = playlist.tracks.find((track) => track.available);
      if (first) select(first, false);
      else status.textContent = '当前歌单暂无可直接播放的歌曲，请在网易云收听。';
      audio.addEventListener('error', () => {
        if (selected) status.textContent = '这首歌暂时无法播放，请在网易云收听。';
      });
    } catch (_) {
      if (root.isConnected && serial === generation) {
        find('summary').textContent = '歌单暂时无法加载';
        status.textContent = '请稍后刷新页面重试。';
      }
    }
  }
  document.addEventListener('pjax:send', leave);
  document.addEventListener('pjax:complete', init);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
