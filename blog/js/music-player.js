'use strict';

(() => {
  if (window.musicPageLoaded) return;
  window.musicPageLoaded = true;
  const assetRoot = GLOBAL_CONFIG.root;
  const liquidSite = (window.GLOBAL_CONFIG_SITE && GLOBAL_CONFIG_SITE.liquid) || {};
  const liquidMusic = liquidSite.music || {};
  if (liquidMusic.enable === false) return;
  const i18n = Object.assign({
    dockLabel: 'Global music player',
    expand: 'Expand music player',
    collapse: 'Collapse music player',
    collapseShort: 'Collapse',
    previous: 'Previous track',
    next: 'Next track',
    play: 'Play',
    pause: 'Pause',
    volume: 'Volume',
    seek: 'Playback position',
    playlist: 'Playlist',
    title: 'Music',
    loading: 'Loading playlist…',
    selectTrack: 'Select a track',
    playFailed: 'Playback is unavailable. Please listen on NetEase Cloud Music.',
    preview: 'Preview only.',
    trackFailed: 'This track is unavailable. Please listen on NetEase Cloud Music.',
    emptyPlaylist: 'No playable tracks in this playlist. Please listen on NetEase Cloud Music.',
    loadFailed: 'The playlist could not be loaded. Refresh the page to retry.'
  }, liquidMusic.i18n || {});
  const playlistUrl = liquidMusic.playlistUrl || (assetRoot + 'music/playlist.json');
  const pageUrl = liquidMusic.pageUrl || (assetRoot + 'music/');
  const storageKey = 'blog-music-playlist-id';

  let playlists = [];
  let activePlaylist = null;
  let playingPlaylistId = null;
  let tracks = [];
  let current = null;
  let statusText = i18n.loading;
  let pageRoot = null;
  let rawSnapshot = '';

  const readSavedPlaylistId = () => {
    try {
      return localStorage.getItem(storageKey) || '';
    } catch (_) {
      return '';
    }
  };
  const savePlaylistId = (id) => {
    try {
      if (id) localStorage.setItem(storageKey, String(id));
    } catch (_) {}
  };

  const icons = {
    previous: '<path d="M5 5h2v14H5zM18 5v14L8 12z"/>',
    next: '<path d="M17 5h2v14h-2zM6 5v14l10-7z"/>',
    play: '<path d="M7 4.5v15L19 12z"/>',
    pause: '<path d="M6.5 5h4v14h-4zM13.5 5h4v14h-4z"/>',
    list: '<path d="M4 6h11v1.8H4zm0 5.1h11v1.8H4zm0 5.1h11v1.8H4zM17 6h3v1.8h-3zm0 5.1h3v1.8h-3zm0 5.1h3v1.8h-3z"/>'
  };
  function setIcon(button, name) {
    if (!button || button.dataset.icon === name) return;
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
  dock.className = 'music-dock is-collapsed';
  dock.setAttribute('aria-label', i18n.dockLabel);
  dock.innerHTML = `
    <button class="music-dock-launcher" type="button" aria-label="${i18n.expand}" title="${i18n.expand}">
      <svg viewBox="10 10 245 145" aria-hidden="true" focusable="false">
        <!-- Adapted from https://commons.wikimedia.org/wiki/File:Sixteenth_note_run.svg
             by Pko and Ekips39/9cfilorux, CC BY-SA 3.0: https://creativecommons.org/licenses/by-sa/3.0/
             Staff removed, stems thickened, cropped and recolored. -->
        <g stroke="currentColor" stroke-width="5" fill="none">
          <path d="M50.8 44.75v84M115.5 34.25v84M181 26.75v80M246.2 17.8v75"/>
        </g>
        <g transform="matrix(.816,-.578,.616,.788,0,0)">
          <ellipse cx="-55.3" cy="130.4" rx="18.8" ry="12.2"/>
          <ellipse cx="3.3" cy="157.8" rx="18.8" ry="12.2"/>
          <ellipse cx="63.6" cy="184.6" rx="18.8" ry="12.2"/>
          <ellipse cx="122.5" cy="212" rx="18.8" ry="12.2"/>
        </g>
        <path d="M247.7 16.5 49.3 42.6v12.9l198.4-26.2ZM247.7 37.4 49.3 63.5v12.9l198.4-26.2Z"/>
      </svg>
    </button>
    <div class="music-dock-body">
      <div class="music-dock-header">
        <div class="music-dock-cover music-cover" aria-hidden="true"><span>♫</span><img data-dock-cover alt="" referrerpolicy="no-referrer" hidden></div>
        <div class="music-dock-info">
          <a data-dock-track></a>
          <small data-dock-artist>${i18n.loading}</small>
        </div>
        <button class="music-dock-playlist-pill" type="button" data-action="playlist" aria-expanded="false" title="${i18n.playlist}">
          <span class="music-dock-playlist-label" data-dock-playlist-name>${i18n.playlist}</span>
          <span class="music-dock-caret" aria-hidden="true">▾</span>
        </button>
        <button class="music-dock-collapse" type="button" data-action="collapse" aria-label="${i18n.collapse}" title="${i18n.collapseShort}">×</button>
      </div>
      <div class="music-dock-lyric" data-dock-lyric hidden></div>
      <div class="music-dock-controls">
        <button type="button" data-action="previous" aria-label="${i18n.previous}" title="${i18n.previous}">⏮</button>
        <button class="music-dock-play" type="button" data-action="toggle" aria-label="${i18n.play}" title="${i18n.play}">▶</button>
        <button type="button" data-action="next" aria-label="${i18n.next}" title="${i18n.next}">⏭</button>
        <label class="music-dock-volume">${i18n.volume} <input data-dock-volume type="range" min="0" max="1" step="0.01" value="1" aria-label="${i18n.volume}"></label>
      </div>
      <div class="music-dock-progress">
        <span data-dock-elapsed>0:00</span>
        <input data-dock-seek type="range" min="0" max="1000" value="0" aria-label="${i18n.seek}">
        <span data-dock-duration>0:00</span>
        <button class="music-dock-list" type="button" data-action="playlist" aria-label="${i18n.playlist}" title="${i18n.playlist}" aria-expanded="false"></button>
      </div>
      <audio preload="none"></audio>
      <p class="music-dock-status" data-dock-status role="status"></p>
    </div>
    <div class="music-dock-playlist" data-dock-playlist hidden>
      <div class="music-dock-playlists" data-dock-playlists></div>
      <ol data-dock-list></ol>
    </div>`;
  document.body.appendChild(dock);
  const dockLiftQuery = window.matchMedia('(max-width: 560px)');
  function placeDock() {
    const open = dockLiftQuery.matches && !dock.classList.contains('is-collapsed');
    document.documentElement.classList.toggle('music-dock-open', open);
    if (!open) {
      document.documentElement.style.removeProperty('--music-dock-lift');
      return;
    }
    const bottom = parseFloat(getComputedStyle(dock).bottom) || 0;
    document.documentElement.style.setProperty('--music-dock-lift', Math.ceil(dock.offsetHeight + bottom + 16) + 'px');
  }
  if (window.ResizeObserver) new ResizeObserver(placeDock).observe(dock);
  dockLiftQuery.addEventListener('change', placeDock);
  const audio = dock.querySelector('audio');
  const findDock = (name) => dock.querySelector('[data-dock-' + name + ']');
  const findPage = (name) => pageRoot && pageRoot.querySelector('[data-music-' + name + ']');
  setTransportIcons(dock, 'data-action');
  setIcon(dock.querySelector('.music-dock-list'), 'list');
  findDock('track').href = pageUrl;
  findDock('track').textContent = i18n.title;
  findDock('track').addEventListener('click', (event) => {
    if (!pageRoot || !pageRoot.isConnected) return;
    const pid = playingPlaylistId || (activePlaylist && activePlaylist.id);
    const target = pid && playlists.find((pl) => String(pl.id) === String(pid));
    if (target) {
      event.preventDefault();
      openPlaylistPage(target, true);
    }
  });

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
  function playlistCover(pl) {
    if (!pl) return '';
    if (pl.cover) return pl.cover;
    const firstWithCover = (pl.tracks || []).find((item) => item && item.cover);
    return firstWithCover ? firstWithCover.cover : '';
  }
  function playlistMetaText(pl) {
    if (!pl) return '';
    const count = (pl.tracks || []).length;
    const parts = [`${count} 首`];
    if (pl.updated) parts.push(pl.updated);
    return parts.join(' · ');
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
  let trackTip = null;
  function ensureTip() {
    if (trackTip && trackTip.isConnected) return trackTip;
    trackTip = document.createElement('div');
    trackTip.className = 'music-track-tip';
    trackTip.setAttribute('role', 'tooltip');
    document.body.appendChild(trackTip);
    return trackTip;
  }
  function showTip(row) {
    if (!row.querySelector('.is-scrolling')) return;
    const tipRoot = ensureTip();
    tipRoot.replaceChildren();
    const name = document.createElement('strong');
    name.textContent = row.dataset.fullName || '';
    tipRoot.append(name);
    if (row.dataset.fullArtist) {
      const artist = document.createElement('small');
      artist.textContent = row.dataset.fullArtist;
      tipRoot.append(artist);
    }
    tipRoot.classList.add('is-open');
    const rowBox = row.getBoundingClientRect();
    const tipBox = tipRoot.getBoundingClientRect();
    let top = rowBox.top - tipBox.height - 8;
    if (top < 8) top = Math.min(window.innerHeight - tipBox.height - 8, rowBox.bottom + 8);
    const left = Math.min(Math.max(8, rowBox.left), window.innerWidth - tipBox.width - 8);
    tipRoot.style.top = `${Math.round(top)}px`;
    tipRoot.style.left = `${Math.round(left)}px`;
  }
  function hideTip() {
    if (trackTip) trackTip.classList.remove('is-open');
  }
  function bindTips(list) {
    if (!list || list.dataset.tipsBound) return;
    list.dataset.tipsBound = 'true';
    list.addEventListener('pointerenter', (event) => {
      const row = event.target.closest('li[data-full-name]');
      if (row && list.contains(row)) showTip(row);
    }, true);
    list.addEventListener('pointerleave', (event) => {
      const row = event.target.closest('li[data-full-name]');
      if (row && list.contains(row) && !row.contains(event.relatedTarget)) hideTip();
    }, true);
  }
  window.addEventListener('scroll', hideTip, { passive: true, capture: true });
  window.addEventListener('resize', hideTip);

  function renderDockPlaylists() {
    const bar = dock.querySelector('[data-dock-playlists]');
    if (!bar) return;
    bar.replaceChildren();
    bar.hidden = playlists.length === 0;
    playlists.forEach((pl) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'music-dock-pl-chip';
      chip.dataset.playlistId = String(pl.id);
      if (activePlaylist && String(activePlaylist.id) === String(pl.id)) chip.classList.add('is-active');

      const thumb = document.createElement('span');
      thumb.className = 'music-dock-pl-thumb';
      thumb.setAttribute('aria-hidden', 'true');
      const url = playlistCover(pl);
      if (url) {
        const img = document.createElement('img');
        img.src = url;
        img.alt = '';
        img.referrerPolicy = 'no-referrer';
        thumb.append(img);
      } else {
        thumb.textContent = '♫';
      }

      const name = document.createElement('span');
      name.className = 'music-dock-pl-name';
      name.textContent = pl.name;

      const count = document.createElement('span');
      count.className = 'music-dock-pl-count';
      count.textContent = String((pl.tracks || []).length);

      chip.title = `${pl.name}（${(pl.tracks || []).length} 首）`;
      chip.append(thumb, name, count);
      bar.append(chip);
    });
  }

  function renderDockList() {
    renderDockPlaylists();
    const list = dock.querySelector('[data-dock-list]');
    list.replaceChildren();
    tracks.forEach((track) => {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.trackId = String(track.id);
      button.disabled = !track.available;
      if (current && String(current.id) === String(track.id)) button.classList.add('is-current');
      const name = document.createElement('strong');
      const nameText = document.createElement('span');
      nameText.className = 'music-track-text';
      nameText.textContent = track.name;
      name.append(nameText);
      const artist = document.createElement('small');
      const artistText = document.createElement('span');
      artistText.className = 'music-track-text';
      artistText.textContent = track.artist;
      artist.append(artistText);
      button.append(name, artist);
      button.title = track.artist ? `${track.name} — ${track.artist}` : track.name;
      item.append(button);
      list.append(item);
    });
    watchOverflow(list);
    bindMarqueeReturn(list, 'button[data-track-id]');
    const currentButton = list.querySelector('.is-current');
    if (currentButton) dock.querySelector('[data-dock-playlist]').scrollTop = Math.max(0, currentButton.offsetTop - 64);
  }

  function setPlaylistOpen(open) {
    dock.classList.toggle('is-playlist-open', open);
    dock.querySelector('[data-dock-playlist]').hidden = !open;
    dock.querySelectorAll('[data-action="playlist"]').forEach((btn) => {
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    if (open) renderDockList();
  }

  function getRoutePlaylistId() {
    try {
      return new URLSearchParams(window.location.search).get('playlist') || '';
    } catch (_) {
      return '';
    }
  }
  function playlistPageHref(id) {
    return id ? `${pageUrl}?playlist=${encodeURIComponent(id)}` : pageUrl;
  }
  function syncPageView() {
    if (!pageRoot || !pageRoot.isConnected) return;
    const gridView = findPage('grid-view');
    const detailView = findPage('detail-view');
    if (!gridView || !detailView) return;
    const routeId = getRoutePlaylistId();
    const target = routeId && playlists.find((pl) => String(pl.id) === String(routeId));
    if (target) {
      gridView.hidden = true;
      detailView.hidden = false;
      activePlaylist = target;
      tracks = Array.isArray(target.tracks) ? target.tracks : [];
      savePlaylistId(target.id);
      renderPageDetail(target);
      if (dock.classList.contains('is-playlist-open')) renderDockList();
    } else {
      gridView.hidden = false;
      detailView.hidden = true;
      renderPlaylistGrid();
    }
    update();
  }
  function openPlaylistPage(pl, pushHistory = true) {
    if (!pl) return;
    if (pushHistory) {
      const nextUrl = playlistPageHref(pl.id);
      if (window.location.pathname + window.location.search !== nextUrl) {
        try {
          window.history.pushState({ musicPlaylistId: String(pl.id) }, '', nextUrl);
        } catch (_) {}
      }
    }
    selectPlaylist(pl, false);
    syncPageView();
    if (pageRoot) pageRoot.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function closePlaylistPage(pushHistory = true) {
    if (pushHistory && getRoutePlaylistId()) {
      try {
        window.history.pushState({ musicPlaylistId: '' }, '', pageUrl);
      } catch (_) {}
    }
    syncPageView();
    if (pageRoot) pageRoot.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  window.addEventListener('popstate', () => {
    if (pageRoot && pageRoot.isConnected) syncPageView();
  });

  function update() {
    const playing = !audio.paused;
    dock.querySelectorAll('[data-action="toggle"]').forEach((button) => {
      setIcon(button, playing ? 'pause' : 'play');
      button.setAttribute('aria-label', playing ? i18n.pause : i18n.play);
      button.title = playing ? i18n.pause : i18n.play;
    });
    const plLabel = findDock('playlist-name');
    if (plLabel && activePlaylist) plLabel.textContent = activePlaylist.name;
    const dockTrackLink = findDock('track');
    if (dockTrackLink) dockTrackLink.href = playlistPageHref(playingPlaylistId || (activePlaylist && activePlaylist.id) || '');
    findDock('status').textContent = statusText;
    findDock('elapsed').textContent = time(audio.currentTime);
    findDock('duration').textContent = time(audio.duration);
    findDock('seek').value = Number.isFinite(audio.duration) && audio.duration ? Math.round(audio.currentTime / audio.duration * 1000) : 0;
    findDock('volume').value = audio.muted ? 0 : audio.volume;
    if (dock.classList.contains('is-playlist-open')) {
      dock.querySelectorAll('[data-track-id]').forEach((button) => {
        button.classList.toggle('is-current', current && button.dataset.trackId === String(current.id));
      });
      dock.querySelectorAll('.music-dock-pl-chip').forEach((chip) => {
        chip.classList.toggle('is-active', activePlaylist && chip.dataset.playlistId === String(activePlaylist.id));
      });
    }
    syncLyrics();
    if (!pageRoot || !pageRoot.isConnected) return;
    const button = pageRoot.querySelector('[data-music-action="toggle"]');
    setIcon(button, playing ? 'pause' : 'play');
    button.setAttribute('aria-label', playing ? i18n.pause : i18n.play);
    findPage('track').textContent = current ? current.name : i18n.selectTrack;
    findPage('artist').textContent = current ? current.artist : '';
    findPage('status').textContent = statusText;
    cover(findPage('cover'), current && current.cover);
    findPage('elapsed').textContent = time(audio.currentTime);
    findPage('duration').textContent = time(audio.duration);
    findPage('seek').value = Number.isFinite(audio.duration) && audio.duration ? Math.round(audio.currentTime / audio.duration * 1000) : 0;
    findPage('volume').value = audio.muted ? 0 : audio.volume;
    pageRoot.querySelectorAll('.music-tracks li').forEach((li) => li.classList.toggle('is-current', current && li.dataset.id === String(current.id)));
    pageRoot.querySelectorAll('.music-playlist-card').forEach((card) => {
      const pid = card.dataset.playlistId;
      const isSelected = activePlaylist && String(activePlaylist.id) === pid;
      const isPlayingThis = playing && playingPlaylistId && String(playingPlaylistId) === pid;
      card.classList.toggle('is-selected', Boolean(isSelected));
      card.classList.toggle('is-playing', Boolean(isPlayingThis));
      const playBtn = card.querySelector('.music-playlist-play');
      if (playBtn) {
        setIcon(playBtn, isPlayingThis ? 'pause' : 'play');
        playBtn.setAttribute('aria-label', isPlayingThis ? i18n.pause : i18n.play);
      }
    });
  }

  function setStatus(message) { statusText = message; update(); }
  function play() {
    if (!current) return;
    audio.play().catch(() => setStatus(i18n.playFailed));
  }
  function select(track, shouldPlay, playlistIdOverride) {
    if (!track) return;
    const changed = !current || String(current.id) !== String(track.id);
    current = track;
    if (playlistIdOverride) playingPlaylistId = String(playlistIdOverride);
    else if (activePlaylist) playingPlaylistId = String(activePlaylist.id);
    findDock('track').textContent = track.name;
    findDock('artist').textContent = track.artist;
    cover(findDock('cover'), track.cover);
    if (changed) audio.src = 'https://music.163.com/song/media/outer/url?id=' + encodeURIComponent(track.id) + '.mp3';
    setStatus(track.preview ? i18n.preview : '');
    if (shouldPlay) play();
  }
  function selectPlaylist(pl, shouldPlayFirst) {
    if (!pl) return;
    activePlaylist = pl;
    tracks = Array.isArray(pl.tracks) ? pl.tracks : [];
    savePlaylistId(pl.id);
    if (pageRoot && pageRoot.isConnected) renderPageDetail(pl);
    if (dock.classList.contains('is-playlist-open')) renderDockList();
    if (shouldPlayFirst) {
      const first = tracks.find((track) => track.available);
      if (first) select(first, true, pl.id);
      else setStatus(i18n.emptyPlaylist);
    } else if (!current || audio.paused) {
      const hasCurrent = current && tracks.some((t) => String(t.id) === String(current.id));
      if (!hasCurrent) {
        const first = tracks.find((track) => track.available);
        if (first) select(first, false, pl.id);
      }
    }
    update();
  }
  function advance(direction, shouldPlay = true) {
    const sourceList = (playingPlaylistId && playlists.find((pl) => String(pl.id) === String(playingPlaylistId))) || activePlaylist;
    const listTracks = sourceList && Array.isArray(sourceList.tracks) ? sourceList.tracks : tracks;
    const playable = listTracks.filter((track) => track.available);
    if (!playable.length) return;
    const index = playable.findIndex((track) => current && String(track.id) === String(current.id));
    select(playable[(index + direction + playable.length) % playable.length], shouldPlay, sourceList && sourceList.id);
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
    if (button.dataset.playlistId) {
      const target = playlists.find((pl) => String(pl.id) === button.dataset.playlistId);
      if (target) selectPlaylist(target, false);
      return;
    }
    if (button.dataset.trackId) {
      const track = tracks.find((item) => String(item.id) === button.dataset.trackId);
      if (track && track.available) {
        select(track, true, activePlaylist && activePlaylist.id);
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
  audio.addEventListener('error', () => { if (current) setStatus(i18n.trackFailed); });

  function renderPlaylistGrid() {
    if (!pageRoot || !pageRoot.isConnected) return;
    const grid = findPage('playlist-grid');
    const countEl = findPage('playlist-count');
    if (!grid) return;
    grid.replaceChildren();
    if (countEl) countEl.textContent = playlists.length ? `${playlists.length} 个歌单` : '';

    playlists.forEach((pl) => {
      const card = document.createElement('article');
      card.className = 'music-playlist-card';
      card.dataset.playlistId = String(pl.id);
      card.tabIndex = 0;
      card.setAttribute('role', 'button');
      card.setAttribute('aria-label', `${pl.name}（${(pl.tracks || []).length} 首）`);

      const coverWrap = document.createElement('div');
      coverWrap.className = 'music-playlist-cover-wrap';

      const fallback = document.createElement('span');
      fallback.className = 'music-playlist-cover-fallback';
      fallback.setAttribute('aria-hidden', 'true');
      fallback.textContent = '♫';
      coverWrap.append(fallback);

      const url = playlistCover(pl);
      if (url) {
        const img = document.createElement('img');
        img.src = url;
        img.alt = pl.name;
        img.loading = 'lazy';
        img.referrerPolicy = 'no-referrer';
        coverWrap.append(img);
      }

      const playBtn = document.createElement('button');
      playBtn.type = 'button';
      playBtn.className = 'music-playlist-play';
      setIcon(playBtn, 'play');
      playBtn.setAttribute('aria-label', i18n.play);
      playBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        const isPlayingThis = !audio.paused && playingPlaylistId && String(playingPlaylistId) === String(pl.id);
        if (isPlayingThis) {
          audio.pause();
        } else if (playingPlaylistId && String(playingPlaylistId) === String(pl.id) && current) {
          play();
        } else {
          selectPlaylist(pl, true);
        }
      });
      coverWrap.append(playBtn);

      const nameEl = document.createElement('div');
      nameEl.className = 'music-playlist-card-name';
      nameEl.textContent = pl.name;
      nameEl.title = pl.name;

      const metaEl = document.createElement('div');
      metaEl.className = 'music-playlist-card-meta';
      metaEl.textContent = playlistMetaText(pl);

      card.append(coverWrap, nameEl, metaEl);
      card.addEventListener('click', () => {
        openPlaylistPage(pl, true);
      });
      card.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          openPlaylistPage(pl, true);
        }
      });
      grid.append(card);
    });
  }

  function renderPageDetail(data) {
    if (!pageRoot || !pageRoot.isConnected || !data) return;
    findPage('title').textContent = data.name;
    const metaEl = findPage('meta');
    if (metaEl) metaEl.textContent = playlistMetaText(data);
    cover(findPage('playlist-cover'), playlistCover(data));
    const linkEl = findPage('playlist-link');
    if (linkEl) {
      if (data.url) {
        linkEl.href = data.url;
        linkEl.hidden = false;
      } else {
        linkEl.hidden = true;
      }
    }
    const list = findPage('tracks');
    list.replaceChildren();
    (data.tracks || []).forEach((track) => {
      const li = document.createElement('li');
      li.dataset.id = track.id;
      const info = document.createElement(track.available ? 'button' : 'div');
      info.className = 'music-track-info';
      if (track.available) {
        info.type = 'button';
        info.addEventListener('click', () => select(track, true, data.id));
      }
      const name = document.createElement('span');
      name.className = 'music-track-name';
      const nameText = document.createElement('span');
      nameText.className = 'music-track-text';
      nameText.textContent = track.name;
      name.append(nameText);
      const artist = document.createElement('small');
      const artistText = document.createElement('span');
      artistText.className = 'music-track-text';
      artistText.textContent = track.artist;
      artist.append(artistText);
      info.append(name, artist);
      li.dataset.fullName = track.name;
      li.dataset.fullArtist = track.artist || '';
      li.append(info);
      list.append(li);
    });
    watchOverflow(list);
    bindTips(list);
    bindMarqueeReturn(list, 'li[data-id]');
    update();
  }

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
      if (event.target.closest('[data-music-back]')) {
        closePlaylistPage(true);
        return;
      }
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
    if (playlists.length) {
      syncPageView();
    }
    update();
  }

  function measureMarquee(scope) {
    scope.querySelectorAll('.music-track-text').forEach((text) => {
      const box = text.parentElement;
      if (!box) return;
      const overflow = text.scrollWidth - box.clientWidth;
      box.classList.remove('is-scrolling');
      box.style.removeProperty('--music-marquee-shift');
      box.style.removeProperty('--music-marquee-duration');
      if (overflow > 2) {
        box.style.setProperty('--music-marquee-shift', `${-overflow}px`);
        box.style.setProperty('--music-marquee-duration', `${Math.min(14, Math.max(4, overflow / 45))}s`);
        box.classList.add('is-scrolling');
      }
    });
  }
  function watchOverflow(scope) {
    if (!scope) return;
    measureMarquee(scope);
    if (typeof ResizeObserver === 'function' && !scope.dataset.marqueeWatched) {
      scope.dataset.marqueeWatched = 'true';
      const observer = new ResizeObserver(() => measureMarquee(scope));
      observer.observe(scope);
    }
  }
  function returnToStart(row) {
    if (!row || !row.querySelector) return;
    row.querySelectorAll('.is-scrolling > .music-track-text').forEach((text) => {
      const currentTransform = getComputedStyle(text).transform;
      if (!currentTransform || currentTransform === 'none') return;
      text.getAnimations().forEach((animation) => animation.cancel());
      try {
        text.animate(
          [{ transform: currentTransform }, { transform: 'translateX(0)' }],
          { duration: 420, easing: 'ease-out', fill: 'none' }
        );
      } catch (_error) {
        text.style.transform = 'translateX(0)';
      }
    });
  }
  function bindMarqueeReturn(list, selector) {
    if (!list || list.dataset.marqueeReturnBound) return;
    list.dataset.marqueeReturnBound = 'true';
    list.addEventListener('pointerleave', (event) => {
      const row = event.target.closest(selector);
      if (!row || !list.contains(row)) return;
      if (event.relatedTarget && row.contains(event.relatedTarget)) return;
      returnToStart(row);
    }, true);
  }

  function normalizePlaylists(data) {
    if (data && Array.isArray(data.playlists) && data.playlists.length) {
      return data.playlists.filter((pl) => pl && Array.isArray(pl.tracks));
    }
    if (data && Array.isArray(data.tracks)) {
      return [data];
    }
    return [];
  }

  document.addEventListener('pjax:complete', initPage);
  initPage();
  let refreshInFlight = false;
  async function refreshPlaylist() {
    if (refreshInFlight) return;
    refreshInFlight = true;
    try {
      const response = await fetch(playlistUrl, { cache: 'no-store' });
      if (!response.ok) throw new Error('playlist unavailable');
      const data = await response.json();
      const nextPlaylists = normalizePlaylists(data);
      if (!nextPlaylists.length) throw new Error('invalid playlist');
      const snapshot = JSON.stringify(nextPlaylists);
      const changed = snapshot !== rawSnapshot;
      rawSnapshot = snapshot;
      playlists = nextPlaylists;

      const routeId = pageRoot && pageRoot.isConnected ? getRoutePlaylistId() : '';
      const preferredId = routeId || (activePlaylist && String(activePlaylist.id)) || readSavedPlaylistId();
      activePlaylist = playlists.find((pl) => String(pl.id) === preferredId) || playlists[0];
      tracks = activePlaylist.tracks || [];

      if (changed) {
        if (current) {
          for (const pl of playlists) {
            const match = (pl.tracks || []).find((track) => String(track.id) === String(current.id));
            if (match) { current = match; break; }
          }
        }
        lyricLines.clear();
        renderedLyricId = null;
        lyricIndex = -1;
        syncPageView();
        if (dock.classList.contains('is-playlist-open')) renderDockList();
      }
      if (!current) {
        const first = tracks.find((track) => track.available);
        if (first) select(first, false, activePlaylist.id);
        else setStatus(i18n.emptyPlaylist);
      } else {
        update();
      }
    } catch (_) {
      if (!playlists.length) setStatus(i18n.loadFailed);
    } finally {
      refreshInFlight = false;
    }
  }
  refreshPlaylist();
  setInterval(() => { if (!document.hidden) refreshPlaylist(); }, 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshPlaylist(); });
})();
