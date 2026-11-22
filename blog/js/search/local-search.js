/* Liquid Spotlight Local Search */
(() => {
  'use strict'

  if (window.__blogSpotlightSearch) return
  window.__blogSpotlightSearch = true

  const MAX_INITIAL_RESULTS = 20
  const MAX_HITS_PER_TERM = 12
  const SNIPPET_LENGTH = 136
  const SNIPPET_LEAD = 34
  const INPUT_DEBOUNCE_MS = 55

  const escapeHtml = str => String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

  const getGlobalConfig = () => (typeof GLOBAL_CONFIG !== 'undefined' ? GLOBAL_CONFIG : window.GLOBAL_CONFIG) || {}

  const resolveEntryUrl = rawUrl => {
    const root = getGlobalConfig().root || '/'
    const cleaned = decodeURIComponent(String(rawUrl || '')).trim()
    if (!cleaned) return root
    if (/^https?:\/\//i.test(cleaned)) return cleaned
    if (cleaned.startsWith('/')) {
      return cleaned.replace(/\/{2,}/g, '/')
    }
    return (root + cleaned).replace(/\/{2,}/g, '/')
  }

  const normalizeArray = value => {
    if (!value) return []
    if (Array.isArray(value)) return value.map(item => String(item).trim()).filter(Boolean)
    const str = String(value).trim()
    return str ? [str] : []
  }

  const findPositions = (textLower, term, limit = MAX_HITS_PER_TERM) => {
    const hits = []
    if (!textLower || !term) return hits
    const len = term.length
    let pos = 0
    while (hits.length < limit && (pos = textLower.indexOf(term, pos)) !== -1) {
      hits.push({ start: pos, end: pos + len })
      pos += len
    }
    return hits
  }

  const mergeRanges = ranges => {
    if (ranges.length <= 1) return ranges
    ranges.sort((a, b) => a.start - b.start || b.end - a.end)
    const merged = [ranges[0]]
    for (let i = 1; i < ranges.length; i++) {
      const prev = merged[merged.length - 1]
      const curr = ranges[i]
      if (curr.start <= prev.end) {
        if (curr.end > prev.end) prev.end = curr.end
      } else {
        merged.push(curr)
      }
    }
    return merged
  }

  const highlightString = (text, terms) => {
    if (!text) return ''
    const lower = text.toLowerCase()
    const ranges = []
    for (const term of terms) {
      let pos = 0
      const len = term.length
      while ((pos = lower.indexOf(term, pos)) !== -1) {
        ranges.push({ start: pos, end: pos + len })
        pos += len
      }
    }
    if (!ranges.length) return escapeHtml(text)
    const merged = mergeRanges(ranges)
    let out = ''
    let cursor = 0
    for (const { start, end } of merged) {
      out += escapeHtml(text.slice(cursor, start))
      out += `<mark class="search-keyword">${escapeHtml(text.slice(start, end))}</mark>`
      cursor = end
    }
    out += escapeHtml(text.slice(cursor))
    return out
  }

  const buildSnippet = (content, contentLower, terms) => {
    if (!content) return ''
    let bestWindow = null
    let bestScore = -1
    const allHits = []

    for (const term of terms) {
      const hits = findPositions(contentLower, term, MAX_HITS_PER_TERM)
      for (const hit of hits) {
        allHits.push({ ...hit, term })
      }
    }

    if (!allHits.length) {
      const trimmed = content.slice(0, SNIPPET_LENGTH).trim()
      return escapeHtml(trimmed) + (content.length > SNIPPET_LENGTH ? '…' : '')
    }

    allHits.sort((a, b) => a.start - b.start)

    // Evaluate candidate windows anchored near each hit to maximize distinct matched terms.
    for (let i = 0; i < Math.min(allHits.length, 16); i++) {
      const anchor = allHits[i]
      const winStart = Math.max(0, anchor.start - SNIPPET_LEAD)
      const winEnd = Math.min(content.length, winStart + SNIPPET_LENGTH)
      const distinct = new Set()
      let count = 0
      for (const hit of allHits) {
        if (hit.start >= winStart && hit.end <= winEnd) {
          distinct.add(hit.term)
          count++
        }
      }
      const score = distinct.size * 100 + count * 10 - i * 0.5
      if (score > bestScore) {
        bestScore = score
        bestWindow = { start: winStart, end: winEnd }
      }
    }

    let { start, end } = bestWindow
    // Gently snap start/end to whitespace for English words when nearby.
    if (start > 0) {
      const nextSpace = content.indexOf(' ', start)
      if (nextSpace !== -1 && nextSpace - start < 10) start = nextSpace + 1
    }
    if (end < content.length) {
      const lastSpace = content.lastIndexOf(' ', end)
      if (lastSpace > start + SNIPPET_LENGTH - 14) end = lastSpace
    }

    const slice = content.slice(start, end).trim()
    const prefix = start > 0 ? '…' : ''
    const suffix = end < content.length ? '…' : ''
    return `${prefix}${highlightString(slice, terms)}${suffix}`
  }

  class SpotlightIndex {
    constructor (path) {
      this.path = path
      this.entries = null
      this.promise = null
      this.error = null
    }

    get isLoaded () {
      return Array.isArray(this.entries)
    }

    load () {
      if (this.isLoaded) return Promise.resolve(this.entries)
      if (this.promise) return this.promise

      this.error = null
      const isXml = /\.xml(?:[?#]|$)/i.test(this.path)

      this.promise = fetch(this.path, { credentials: 'same-origin' })
        .then(response => {
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          return isXml ? response.text() : response.json()
        })
        .then(raw => {
          const list = isXml ? this.parseXml(raw) : Array.isArray(raw) ? raw : []
          this.entries = list
            .map(item => this.normalize(item))
            .filter(item => item && item.title)
          return this.entries
        })
        .catch(err => {
          this.error = err
          this.promise = null
          throw err
        })

      return this.promise
    }

    parseXml (xmlText) {
      const doc = new DOMParser().parseFromString(xmlText, 'text/xml')
      return [...doc.querySelectorAll('entry')].map(el => ({
        title: el.querySelector('title')?.textContent || '',
        content: el.querySelector('content')?.textContent || '',
        url: el.querySelector('url')?.textContent || '',
        categories: [...el.querySelectorAll('categories category')].map(node => node.textContent || ''),
        tags: [...el.querySelectorAll('tags tag')].map(node => node.textContent || '')
      }))
    }

    normalize (item) {
      if (!item || typeof item !== 'object') return null
      const title = String(item.t ?? item.title ?? '').trim()
      if (!title) return null

      const mathRaw = String(item.m || '').trim()
      const content = String(item.x ?? item.content ?? '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
      const categories = normalizeArray(item.c ?? item.categories)
      const tags = normalizeArray(item.g ?? item.tags)
      const series = String(item.s ?? item.series ?? '').trim()
      const date = String(item.d ?? item.date ?? '').trim()
      const url = resolveEntryUrl(item.u ?? item.url ?? '')

      const metaTokens = [...categories, ...tags]
      if (series) metaTokens.push(series)

      return {
        title,
        titleLower: title.toLowerCase(),
        mathRawLower: mathRaw ? mathRaw.toLowerCase() : '',
        content,
        contentLower: content.toLowerCase(),
        categories,
        tags,
        series,
        metaTokensLower: metaTokens.map(t => t.toLowerCase()),
        date,
        url
      }
    }

    search (rawQuery) {
      if (!this.isLoaded) return []
      const normalized = rawQuery.trim().toLowerCase()
      if (!normalized) return []

      const terms = [...new Set(normalized.split(/\s+/).filter(Boolean))]
      if (!terms.length) return []

      const results = []
      const fullQuery = terms.join(' ')

      for (const entry of this.entries) {
        let matchedTerms = 0
        let score = 0
        let hasContentHit = false
        const matchedMeta = new Set()

        if (entry.titleLower === fullQuery) {
          score += 260
        } else if (entry.titleLower.startsWith(fullQuery)) {
          score += 170
        }

        for (const term of terms) {
          let termMatched = false

          const titlePos = entry.titleLower.indexOf(term)
          if (titlePos !== -1) {
            termMatched = true
            score += titlePos === 0 ? 150 : 115
          } else if (entry.mathRawLower && entry.mathRawLower.includes(term)) {
            termMatched = true
            score += 95
          }

          for (const meta of entry.metaTokensLower) {
            if (meta === term) {
              termMatched = true
              score += 85
              matchedMeta.add(meta)
            } else if (meta.includes(term)) {
              termMatched = true
              score += 55
              matchedMeta.add(meta)
            }
          }

          if (entry.contentLower) {
            const hits = findPositions(entry.contentLower, term, MAX_HITS_PER_TERM)
            if (hits.length) {
              termMatched = true
              hasContentHit = true
              score += 24 + Math.min(24, Math.round(Math.log2(hits.length + 1) * 10))
            }
          }

          if (termMatched) matchedTerms++
        }

        if (matchedTerms === 0) continue

        results.push({
          entry,
          terms,
          matchedTerms,
          score,
          hasContentHit,
          matchedMeta
        })
      }

      results.sort((a, b) => {
        if (a.matchedTerms !== b.matchedTerms) return b.matchedTerms - a.matchedTerms
        if (a.score !== b.score) return b.score - a.score
        return b.entry.date.localeCompare(a.entry.date)
      })

      return results
    }
  }

  const highlightArticleWords = body => {
    if (!body) return
    const params = new URL(location.href).searchParams.get('highlight')
    const terms = params ? [...new Set(params.trim().toLowerCase().split(/\s+/).filter(Boolean))] : []
    if (!terms.length) return

    const skipSelector = 'script, style, button, select, textarea, .mermaid, .katex, svg, .gutter, mark.search-keyword'
    const walk = document.createTreeWalker(body, NodeFilter.SHOW_TEXT, null)
    const nodes = []
    while (walk.nextNode()) {
      const parent = walk.currentNode.parentElement
      if (!parent || parent.closest(skipSelector)) continue
      if (walk.currentNode.nodeValue && walk.currentNode.nodeValue.trim()) {
        nodes.push(walk.currentNode)
      }
    }

    for (const node of nodes) {
      const text = node.nodeValue
      const lower = text.toLowerCase()
      const ranges = []
      for (const term of terms) {
        let pos = 0
        const len = term.length
        while ((pos = lower.indexOf(term, pos)) !== -1) {
          ranges.push({ start: pos, end: pos + len })
          pos += len
        }
      }
      if (!ranges.length) continue
      const merged = mergeRanges(ranges)
      const fragment = document.createDocumentFragment()
      let cursor = 0
      for (const { start, end } of merged) {
        if (start > cursor) fragment.appendChild(document.createTextNode(text.slice(cursor, start)))
        const mark = document.createElement('mark')
        mark.className = 'search-keyword'
        mark.textContent = text.slice(start, end)
        fragment.appendChild(mark)
        cursor = end
      }
      if (cursor < text.length) fragment.appendChild(document.createTextNode(text.slice(cursor)))
      node.parentNode.replaceChild(fragment, node)
    }
  }

  const init = () => {
    const config = getGlobalConfig().localSearch
    if (!config || !config.path) return

    const root = document.getElementById('local-search')
    if (!root) return

    const mask = document.getElementById('search-mask')
    const dialog = root.querySelector('.spotlight-dialog')
    const iconWrap = root.querySelector('.spotlight-icon')
    const input = root.querySelector('#local-search-input input')
    const clearBtn = root.querySelector('.spotlight-clear')
    const closeBtn = root.querySelector('.search-close-button')
    const bodyEl = root.querySelector('.spotlight-body')
    const resultsEl = document.getElementById('local-search-results')
    const statsEl = document.getElementById('local-search-stats-wrap')

    if (!dialog || !input || !resultsEl || !statsEl) return

    const languages = config.languages || {}
    const engine = new SpotlightIndex(config.path)
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')

    let isOpen = false
    let isComposing = false
    let closeTimer = null
    let debounceTimer = null
    let lastFocused = null
    let currentResults = []
    let renderedCount = 0
    let activeIndex = -1
    let lastPointerX = -1
    let lastPointerY = -1
    let savedBodyOverflow = ''
    let savedBodyPaddingRight = ''

    const lockScroll = () => {
      savedBodyOverflow = document.body.style.overflow
      savedBodyPaddingRight = document.body.style.paddingRight
      const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth
      if (scrollbarWidth > 0) {
        document.body.style.paddingRight = `${scrollbarWidth}px`
        const navMenus = document.querySelector('#page-header.nav-fixed #menus')
        if (navMenus) navMenus.style.paddingRight = `${scrollbarWidth}px`
      }
      document.body.style.overflow = 'hidden'
    }

    const unlockScroll = () => {
      document.body.style.overflow = savedBodyOverflow
      document.body.style.paddingRight = savedBodyPaddingRight
      const navMenus = document.querySelector('#page-header.nav-fixed #menus')
      if (navMenus) navMenus.style.paddingRight = ''
    }

    const setLoading = loading => {
      iconWrap && iconWrap.classList.toggle('is-loading', loading)
    }

    const updateClearButton = () => {
      if (clearBtn) clearBtn.hidden = input.value.length === 0
    }

    const setStatsText = text => {
      statsEl.textContent = text || ''
    }

    const updateIdleFooter = () => {
      if (engine.isLoaded) {
        const template = languages.indexed_stats || '${total} posts indexed'
        setStatsText(template.replace(/\$\{total}/g, String(engine.entries.length)))
      } else if (engine.error) {
        setStatsText(languages.load_error || 'Failed to load search index')
      } else {
        setStatsText(languages.load_data || 'Loading…')
      }
    }

    const setActive = (nextIndex, shouldScroll = true) => {
      const items = resultsEl.querySelectorAll('.spotlight-item')
      if (!items.length) {
        activeIndex = -1
        input.removeAttribute('aria-activedescendant')
        return
      }
      const clamped = ((nextIndex % items.length) + items.length) % items.length
      if (activeIndex >= 0 && items[activeIndex]) {
        items[activeIndex].classList.remove('is-active')
        items[activeIndex].setAttribute('aria-selected', 'false')
      }
      activeIndex = clamped
      const activeItem = items[activeIndex]
      activeItem.classList.add('is-active')
      activeItem.setAttribute('aria-selected', 'true')
      input.setAttribute('aria-activedescendant', activeItem.id)
      if (shouldScroll) {
        activeItem.scrollIntoView({ block: 'nearest' })
      }
    }

    const createResultElement = (result, idx) => {
      const { entry, terms, matchedMeta } = result
      const urlObj = new URL(entry.url, location.origin)
      urlObj.searchParams.set('highlight', terms.join(' '))

      const li = document.createElement('li')
      li.setAttribute('role', 'presentation')

      const a = document.createElement('a')
      a.className = 'spotlight-item'
      a.id = `spotlight-option-${idx}`
      a.href = urlObj.href
      a.setAttribute('role', 'option')
      a.setAttribute('aria-selected', 'false')
      a.dataset.index = String(idx)

      const snippetHtml = buildSnippet(entry.content, entry.contentLower, terms)
      const chips = []
      if (entry.series) {
        chips.push(`<span class="spotlight-chip"><i class="fas fa-layer-group" aria-hidden="true"></i>${highlightString(entry.series, terms)}</span>`)
      }
      for (const cat of entry.categories.slice(0, 2)) {
        chips.push(`<span class="spotlight-chip"><i class="fas fa-folder" aria-hidden="true"></i>${highlightString(cat, terms)}</span>`)
      }
      // Prioritize matched tags first, then up to 3 tags total.
      const sortedTags = [...entry.tags].sort((t1, t2) => {
        const m1 = matchedMeta.has(t1.toLowerCase()) ? 1 : 0
        const m2 = matchedMeta.has(t2.toLowerCase()) ? 1 : 0
        return m2 - m1
      })
      for (const tag of sortedTags.slice(0, 3)) {
        chips.push(`<span class="spotlight-chip"><i class="fas fa-tag" aria-hidden="true"></i>${highlightString(tag, terms)}</span>`)
      }

      a.innerHTML =
        '<div class="spotlight-item-main">' +
          '<div class="spotlight-item-head">' +
            `<span class="spotlight-item-title">${highlightString(entry.title, terms)}</span>` +
            (entry.date ? `<time class="spotlight-item-date">${escapeHtml(entry.date)}</time>` : '') +
          '</div>' +
          (snippetHtml ? `<p class="spotlight-item-snippet">${snippetHtml}</p>` : '') +
          (chips.length ? `<div class="spotlight-item-meta">${chips.join('')}</div>` : '') +
        '</div>' +
        '<span class="spotlight-item-enter" aria-hidden="true">↵</span>'

      li.appendChild(a)
      return li
    }

    const renderResultsBatch = (startIndex, endIndex, listEl) => {
      const fragment = document.createDocumentFragment()
      for (let i = startIndex; i < endIndex; i++) {
        fragment.appendChild(createResultElement(currentResults[i], i))
      }
      listEl.appendChild(fragment)
      renderedCount = endIndex
    }

    const renderErrorState = () => {
      bodyEl.hidden = false
      const msg = escapeHtml(languages.load_error || 'Failed to load search index')
      const retryLabel = escapeHtml(languages.retry || 'Retry')
      resultsEl.innerHTML =
        '<div class="spotlight-empty">' +
          '<i class="fas fa-exclamation-circle" aria-hidden="true"></i>' +
          `<p>${msg}</p>` +
          `<button type="button" class="spotlight-retry">${retryLabel}</button>` +
        '</div>'
      setStatsText(languages.load_error || 'Failed to load search index')
      activeIndex = -1
      input.removeAttribute('aria-activedescendant')
    }

    const renderSearch = () => {
      const query = input.value.trim()
      updateClearButton()

      if (!query) {
        currentResults = []
        renderedCount = 0
        activeIndex = -1
        resultsEl.textContent = ''
        bodyEl.hidden = true
        input.removeAttribute('aria-activedescendant')
        updateIdleFooter()
        return
      }

      if (!engine.isLoaded) {
        if (engine.error) {
          renderErrorState()
        } else {
          setStatsText(languages.load_data || 'Loading…')
        }
        return
      }

      currentResults = engine.search(query)
      renderedCount = 0
      activeIndex = -1
      bodyEl.hidden = false
      bodyEl.scrollTop = 0

      if (!currentResults.length) {
        const emptyTemplate = languages.hits_empty || 'No results found for "${query}"'
        const emptyText = emptyTemplate.replace(/\$\{query}/g, query)
        resultsEl.innerHTML =
          '<div class="spotlight-empty">' +
            '<i class="fas fa-search" aria-hidden="true"></i>' +
            `<p>${escapeHtml(emptyText)}</p>` +
          '</div>'
        setStatsText((languages.hits_stats || '${hits} posts found').replace(/\$\{hits}/g, '0'))
        input.removeAttribute('aria-activedescendant')
        return
      }

      const listEl = document.createElement('ol')
      listEl.className = 'spotlight-list'
      const initialLimit = Math.min(currentResults.length, MAX_INITIAL_RESULTS)
      renderResultsBatch(0, initialLimit, listEl)

      resultsEl.textContent = ''
      resultsEl.appendChild(listEl)

      if (currentResults.length > initialLimit) {
        const remaining = currentResults.length - initialLimit
        const moreBtn = document.createElement('button')
        moreBtn.type = 'button'
        moreBtn.className = 'spotlight-more'
        moreBtn.textContent = (languages.show_more || 'Show ${remaining} more results')
          .replace(/\$\{remaining}/g, String(remaining))
        moreBtn.addEventListener('click', () => {
          renderResultsBatch(renderedCount, currentResults.length, listEl)
          moreBtn.remove()
        })
        resultsEl.appendChild(moreBtn)
      }

      const statsTemplate = languages.hits_stats || '${hits} posts found'
      setStatsText(statsTemplate.replace(/\$\{hits}/g, String(currentResults.length)))
      setActive(0, false)
    }

    const ensureIndexLoaded = () => {
      if (engine.isLoaded) {
        updateIdleFooter()
        return Promise.resolve(engine.entries)
      }
      setLoading(true)
      setStatsText(languages.load_data || 'Loading…')
      return engine.load()
        .then(entries => {
          setLoading(false)
          if (isOpen) {
            if (input.value.trim()) renderSearch()
            else updateIdleFooter()
          }
          return entries
        })
        .catch(() => {
          setLoading(false)
          if (isOpen) renderErrorState()
        })
    }

    const prefetchIndex = () => {
      if (engine.isLoaded || engine.promise) return
      engine.load().catch(() => {})
    }

    const navigateToLink = (anchor, openInNewTab = false) => {
      const href = anchor.href
      if (!href) return
      if (openInNewTab) {
        window.open(href, '_blank', 'noopener')
        return
      }
      closeSearch({ restoreFocus: false })
      if (window.pjax && typeof window.pjax.loadUrl === 'function') {
        window.pjax.loadUrl(href)
      } else {
        window.location.href = href
      }
    }

    const openSearch = () => {
      if (isOpen) return
      if (closeTimer) {
        clearTimeout(closeTimer)
        closeTimer = null
      }

      // Close mobile sidebar if currently open so overlays do not overlap.
      const sidebarMenus = document.getElementById('sidebar-menus')
      if (sidebarMenus && sidebarMenus.classList.contains('open')) {
        const menuMask = document.getElementById('menu-mask')
        menuMask && menuMask.click()
      }

      lastFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
      isOpen = true
      lockScroll()

      root.hidden = false
      root.setAttribute('aria-hidden', 'false')
      // Trigger style flush so the CSS open transition runs cleanly from initial state.
      void dialog.offsetWidth
      root.classList.add('is-open')

      ensureIndexLoaded()
      updateClearButton()
      if (input.value.trim()) {
        renderSearch()
      } else {
        bodyEl.hidden = true
        updateIdleFooter()
      }

      requestAnimationFrame(() => {
        input.focus({ preventScroll: true })
        if (input.value) input.select()
      })
    }

    const closeSearch = ({ restoreFocus = true } = {}) => {
      if (!isOpen) return
      isOpen = false
      root.classList.remove('is-open')
      root.setAttribute('aria-hidden', 'true')
      unlockScroll()

      const finish = () => {
        if (isOpen) return
        root.hidden = true
        if (closeTimer) {
          clearTimeout(closeTimer)
          closeTimer = null
        }
        if (restoreFocus && lastFocused && document.contains(lastFocused)) {
          lastFocused.focus({ preventScroll: true })
        }
        lastFocused = null
      }

      if (reducedMotion.matches) {
        finish()
      } else {
        const onEnd = event => {
          if (event.target !== dialog) return
          dialog.removeEventListener('transitionend', onEnd)
          finish()
        }
        dialog.addEventListener('transitionend', onEnd)
        closeTimer = setTimeout(() => {
          dialog.removeEventListener('transitionend', onEnd)
          finish()
        }, 260)
      }
    }

    const scheduleSearch = () => {
      if (debounceTimer) clearTimeout(debounceTimer)
      if (!input.value.trim()) {
        renderSearch()
        return
      }
      debounceTimer = setTimeout(() => {
        debounceTimer = null
        renderSearch()
      }, INPUT_DEBOUNCE_MS)
    }

    input.addEventListener('compositionstart', () => {
      isComposing = true
    })

    input.addEventListener('compositionend', () => {
      isComposing = false
      renderSearch()
    })

    input.addEventListener('input', () => {
      updateClearButton()
      if (!isComposing) scheduleSearch()
    })

    input.addEventListener('keydown', event => {
      if (event.isComposing || isComposing) return
      if (event.key === 'ArrowDown' || (event.ctrlKey && event.key.toLowerCase() === 'n')) {
        event.preventDefault()
        setActive(activeIndex + 1, true)
      } else if (event.key === 'ArrowUp' || (event.ctrlKey && event.key.toLowerCase() === 'p')) {
        event.preventDefault()
        setActive(activeIndex - 1, true)
      } else if (event.key === 'Enter') {
        const items = resultsEl.querySelectorAll('.spotlight-item')
        const target = items[activeIndex >= 0 ? activeIndex : 0]
        if (target) {
          event.preventDefault()
          navigateToLink(target, event.metaKey || event.ctrlKey)
        }
      }
    })

    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        input.value = ''
        renderSearch()
        input.focus({ preventScroll: true })
      })
    }

    if (closeBtn) closeBtn.addEventListener('click', () => closeSearch())
    if (mask) mask.addEventListener('click', () => closeSearch())

    resultsEl.addEventListener('pointermove', event => {
      if (event.clientX === lastPointerX && event.clientY === lastPointerY) return
      lastPointerX = event.clientX
      lastPointerY = event.clientY
      const item = event.target.closest('.spotlight-item')
      if (!item) return
      const idx = Number(item.dataset.index)
      if (!Number.isNaN(idx) && idx !== activeIndex) {
        setActive(idx, false)
      }
    })

    resultsEl.addEventListener('click', event => {
      const retryBtn = event.target.closest('.spotlight-retry')
      if (retryBtn) {
        ensureIndexLoaded()
        return
      }
      const link = event.target.closest('.spotlight-item')
      if (!link) return
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return
      event.preventDefault()
      navigateToLink(link, false)
    })

    // Delegated click & intent-prefetch on #search-button survive PJAX automatically.
    document.addEventListener('click', event => {
      if (event.target.closest('#search-button .search')) {
        event.preventDefault()
        openSearch()
      }
    })

    document.addEventListener('pointerenter', event => {
      if (event.target instanceof Element && event.target.closest('#search-button')) {
        prefetchIndex()
      }
    }, true)

    document.addEventListener('focusin', event => {
      if (event.target instanceof Element && event.target.closest('#search-button')) {
        prefetchIndex()
      }
    })

    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && isOpen) {
        event.preventDefault()
        closeSearch()
        return
      }

      if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 'k') {
        const viewerOpen = document.querySelector('.iv-overlay.is-open')
        if (viewerOpen) return
        event.preventDefault()
        isOpen ? closeSearch() : openSearch()
        return
      }

      if (
        event.key === '/' &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !isOpen
      ) {
        const active = document.activeElement
        const isEditable = active && (
          active.tagName === 'INPUT' ||
          active.tagName === 'TEXTAREA' ||
          active.tagName === 'SELECT' ||
          active.isContentEditable
        )
        if (isEditable) return
        const viewerOpen = document.querySelector('.iv-overlay.is-open')
        if (viewerOpen) return
        event.preventDefault()
        openSearch()
      }
    })

    if (config.preload) {
      prefetchIndex()
    }

    highlightArticleWords(document.getElementById('article-container'))

    document.addEventListener('pjax:complete', () => {
      if (isOpen) closeSearch({ restoreFocus: false })
      highlightArticleWords(document.getElementById('article-container'))
    })
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true })
  } else {
    init()
  }
})()
