/**
 * Liquid
 * 图片查看器
 *
 * 点击正文图片打开全屏查看：滚轮 / 双击 / 按钮缩放，放大后拖动平移，
 * 双指捏合缩放，方向键切换上下张，下载原图，Esc 或点背景关闭。
 * 不依赖任何第三方库，样式见 css/image-viewer.css。
 */

;(() => {
  'use strict'

  if (window.__liquidImageViewer) return
  window.__liquidImageViewer = true

  const CONTAINER_SELECTOR = '#article-container'
  const MIN_SCALE = 0.25
  const MAX_SCALE = 8
  const ZOOM_STEP = 1.3

  let overlay = null
  let stage = null
  let image = null
  let caption = null
  let counter = null
  let prevBtn = null
  let nextBtn = null
  let downloadLink = null

  let gallery = []
  let index = 0
  let scale = 1
  let tx = 0
  let ty = 0
  let dragging = false
  let moved = false
  let startX = 0
  let startY = 0
  let startTx = 0
  let startTy = 0
  let pointers = new Map()
  let pinchStart = 0
  let pinchScale = 1
  let lastFocus = null
  let scrollbar = ''

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

  const sourceOf = img => img.dataset.lazySrc || img.dataset.src || img.currentSrc || img.src

  const collect = () =>
    Array.from(document.querySelectorAll(`${CONTAINER_SELECTOR} img`)).filter(
      img => !img.closest('a') && !img.classList.contains('no-viewer') && sourceOf(img)
    )

  const apply = animate => {
    if (!image) return
    image.classList.toggle('is-animating', Boolean(animate))
    image.style.transform = `translate3d(${tx}px, ${ty}px, 0) scale(${scale})`
    stage.classList.toggle('is-zoomed', scale > 1.001)
  }

  /* 以 stage 中心为原点的坐标下，围绕光标缩放：t' = c - k * (c - t) */
  const zoomAt = (factor, clientX, clientY, animate = true) => {
    const next = clamp(scale * factor, MIN_SCALE, MAX_SCALE)
    if (next === scale) return
    const rect = stage.getBoundingClientRect()
    const cx = clientX - rect.left - rect.width / 2
    const cy = clientY - rect.top - rect.height / 2
    const k = next / scale
    tx = cx - k * (cx - tx)
    ty = cy - k * (cy - ty)
    scale = next
    if (scale <= 1.001) {
      tx = 0
      ty = 0
    }
    apply(animate)
  }

  const zoomCenter = factor => {
    const rect = stage.getBoundingClientRect()
    zoomAt(factor, rect.left + rect.width / 2, rect.top + rect.height / 2)
  }

  const reset = () => {
    scale = 1
    tx = 0
    ty = 0
    apply(true)
  }

  const setCaption = () => {
    const text = image ? image.alt || '' : ''
    caption.textContent = text
    caption.classList.toggle('is-empty', !text)
  }

  const setCounter = () => {
    const many = gallery.length > 1
    counter.textContent = many ? `${index + 1} / ${gallery.length}` : ''
    prevBtn.hidden = !many
    nextBtn.hidden = !many
  }

  const setDownload = () => {
    if (!downloadLink || !image) return
    const src = image.currentSrc || image.src
    downloadLink.href = src || '#'
    const name = decodeURIComponent((src || '').split('?')[0].split('/').pop() || '')
    if (name) downloadLink.setAttribute('download', name)
    else downloadLink.removeAttribute('download')
  }

  const show = i => {
    if (!gallery.length) return
    index = (i + gallery.length) % gallery.length
    const source = gallery[index]
    image.src = sourceOf(source)
    image.alt = source.alt || ''
    reset()
    stage.scrollTop = 0
    setCaption()
    setCounter()
    setDownload()
  }

  const open = (img) => {
    gallery = collect()
    const at = gallery.indexOf(img)
    if (at === -1) return
    build()
    lastFocus = document.activeElement
    show(at)
    overlay.hidden = false
    requestAnimationFrame(() => overlay.classList.add('is-open'))
    scrollbar = window.innerWidth - document.documentElement.clientWidth
    document.body.style.overflow = 'hidden'
    if (scrollbar > 0) document.body.style.paddingRight = `${scrollbar}px`
    document.addEventListener('keydown', onKeydown)
    const closeBtn = overlay.querySelector('[data-act="close"]')
    if (closeBtn) closeBtn.focus({ preventScroll: true })
  }

  const close = () => {
    if (!overlay || !overlay.classList.contains('is-open')) return
    overlay.classList.remove('is-open')
    document.removeEventListener('keydown', onKeydown)
    document.body.style.overflow = ''
    document.body.style.paddingRight = ''
    window.setTimeout(() => {
      if (!overlay.classList.contains('is-open')) {
        overlay.hidden = true
        image.removeAttribute('src')
      }
    }, 200)
    if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true })
  }

  const onKeydown = e => {
    if (e.key === 'Escape') {
      e.preventDefault()
      close()
      return
    }
    if (e.key === 'ArrowRight' && gallery.length > 1) {
      e.preventDefault()
      show(index + 1)
      return
    }
    if (e.key === 'ArrowLeft' && gallery.length > 1) {
      e.preventDefault()
      show(index - 1)
      return
    }
    if (e.key === '+' || e.key === '=') {
      e.preventDefault()
      zoomCenter(ZOOM_STEP)
      return
    }
    if (e.key === '-') {
      e.preventDefault()
      zoomCenter(1 / ZOOM_STEP)
      return
    }
    if (e.key === '0') {
      e.preventDefault()
      reset()
    }
  }

  const onPointerDown = e => {
    if (e.target === image || e.target === stage) {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (pointers.size === 1) {
        dragging = true
        moved = false
        startX = e.clientX
        startY = e.clientY
        startTx = tx
        startTy = ty
        stage.classList.add('is-dragging')
        try {
          stage.setPointerCapture(e.pointerId)
        } catch (err) {
          /* 合成事件或已释放的指针没有可捕获对象，忽略即可 */
        }
      } else if (pointers.size === 2) {
        const [a, b] = Array.from(pointers.values())
        pinchStart = Math.hypot(a.x - b.x, a.y - b.y) || 1
        pinchScale = scale
        dragging = false
        stage.classList.remove('is-dragging')
      }
    }
  }

  const onPointerMove = e => {
    if (!pointers.has(e.pointerId)) return
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })

    if (pointers.size === 2) {
      const [a, b] = Array.from(pointers.values())
      const distance = Math.hypot(a.x - b.x, a.y - b.y) || 1
      const next = clamp((pinchScale * distance) / pinchStart, MIN_SCALE, MAX_SCALE)
      const k = next / scale
      const cx = (a.x + b.x) / 2 - stage.getBoundingClientRect().left - stage.clientWidth / 2
      const cy = (a.y + b.y) / 2 - stage.getBoundingClientRect().top - stage.clientHeight / 2
      tx = cx - k * (cx - tx)
      ty = cy - k * (cy - ty)
      scale = next
      if (scale <= 1.001) {
        tx = 0
        ty = 0
      }
      apply(false)
      return
    }

    if (!dragging) return
    const dx = e.clientX - startX
    const dy = e.clientY - startY
    if (Math.abs(dx) + Math.abs(dy) > 3) moved = true
    if (scale > 1.001) {
      tx = startTx + dx
      ty = startTy + dy
      apply(false)
    }
  }

  const onPointerUp = e => {
    pointers.delete(e.pointerId)
    if (pointers.size === 0) {
      dragging = false
      stage.classList.remove('is-dragging')
    }
    if (pointers.size < 2) pinchStart = 0
  }

  const onWheel = e => {
    e.preventDefault()
    const factor = Math.exp(-e.deltaY * 0.0018)
    zoomAt(factor, e.clientX, e.clientY, false)
  }

  const onDoubleClick = e => {
    if (scale > 1.001) {
      reset()
    } else {
      zoomAt(2.5, e.clientX, e.clientY)
    }
  }

  const build = () => {
    if (overlay) return
    overlay = document.createElement('div')
    overlay.className = 'iv-overlay'
    overlay.hidden = true
    overlay.setAttribute('role', 'dialog')
    overlay.setAttribute('aria-modal', 'true')
    overlay.setAttribute('aria-label', '图片查看')
    overlay.innerHTML = `
      <div class="iv-stage" data-role="stage">
        <img class="iv-image" alt="" draggable="false">
      </div>
      <span class="iv-counter"></span>
      <div class="iv-toolbar">
        <button class="iv-btn" type="button" data-act="zoom-out" title="缩小" aria-label="缩小"><i class="fas fa-search-minus"></i></button>
        <button class="iv-btn" type="button" data-act="zoom-in" title="放大" aria-label="放大"><i class="fas fa-search-plus"></i></button>
        <button class="iv-btn" type="button" data-act="reset" title="还原" aria-label="还原"><i class="fas fa-compress"></i></button>
        <a class="iv-btn" data-role="download" title="保存图片" aria-label="保存图片" download><i class="fas fa-download"></i></a>
        <button class="iv-btn" type="button" data-act="close" title="关闭" aria-label="关闭"><i class="fas fa-times"></i></button>
      </div>
      <button class="iv-nav iv-nav-prev" type="button" data-act="prev" title="上一张" aria-label="上一张"><i class="fas fa-chevron-left"></i></button>
      <button class="iv-nav iv-nav-next" type="button" data-act="next" title="下一张" aria-label="下一张"><i class="fas fa-chevron-right"></i></button>
      <p class="iv-caption"></p>
    `
    document.body.appendChild(overlay)

    stage = overlay.querySelector('[data-role="stage"]')
    image = overlay.querySelector('.iv-image')
    caption = overlay.querySelector('.iv-caption')
    counter = overlay.querySelector('.iv-counter')
    prevBtn = overlay.querySelector('.iv-nav-prev')
    nextBtn = overlay.querySelector('.iv-nav-next')
    downloadLink = overlay.querySelector('[data-role="download"]')

    stage.addEventListener('pointerdown', onPointerDown)
    stage.addEventListener('pointermove', onPointerMove)
    stage.addEventListener('pointerup', onPointerUp)
    stage.addEventListener('pointercancel', onPointerUp)
    stage.addEventListener('wheel', onWheel, { passive: false })
    stage.addEventListener('dblclick', onDoubleClick)
    stage.addEventListener('dragstart', e => e.preventDefault())
    image.addEventListener('click', e => {
      if (!moved) e.stopPropagation()
    })

    overlay.addEventListener('click', e => {
      const btn = e.target.closest('[data-act]')
      if (btn) {
        const act = btn.dataset.act
        if (act === 'zoom-in') zoomCenter(ZOOM_STEP)
        else if (act === 'zoom-out') zoomCenter(1 / ZOOM_STEP)
        else if (act === 'reset') reset()
        else if (act === 'close') close()
        else if (act === 'prev') show(index - 1)
        else if (act === 'next') show(index + 1)
        return
      }
      if (e.target === stage) close()
    })
  }

  document.addEventListener('click', e => {
    if (e.defaultPrevented) return
    const img = e.target.closest(`${CONTAINER_SELECTOR} img`)
    if (!img || img.closest('a') || img.classList.contains('no-viewer')) return
    e.preventDefault()
    open(img)
  })
})()
