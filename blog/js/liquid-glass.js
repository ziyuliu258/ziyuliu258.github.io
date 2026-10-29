/* Glass edge refraction and pointer lighting; no continuous animation loop. */
(() => {
  'use strict'

  if (window.__blogLiquidGlass) return
  window.__blogLiquidGlass = true

  const selector = [
    '#recent-posts .recent-post-item',
    '#recent-posts .home-announcement',
    '#aside-content .card-widget',
    '.layout > div:first-child:not(.nc)',
    '#nav'
  ].join(', ')

  const pointer = matchMedia('(hover: hover) and (pointer: fine)')
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)')
  const reducedTransparency = matchMedia('(prefers-reduced-transparency: reduce)')
  let active = null
  let frame = 0
  let x = 0
  let y = 0

  // SVG backdrop filters currently need a Chromium enhancement; other engines
  // keep the CSS glass. Build a static edge map only when a surface resizes.
  const chromium = /Chrome\/|Chromium\//.test(navigator.userAgent)
  const refracting = chromium && CSS.supports('backdrop-filter', 'url("#glass")') && 'ResizeObserver' in window
  const surfaces = new Map()
  const ns = 'http://www.w3.org/2000/svg'
  let definitions
  let nextId = 0

  function svgElement(tag, attributes) {
    const element = document.createElementNS(ns, tag)
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value)
    return element
  }

  function updateRefraction(surface) {
    if (!pointer.matches || reducedTransparency.matches) {
      surface.style.removeProperty('--glass-backdrop')
      return
    }
    const rect = surface.getBoundingClientRect()
    const style = getComputedStyle(surface)
    const strength = Number.parseFloat(style.getPropertyValue('--glass-refraction')) || 0
    if (!strength || !rect.width || !rect.height || rect.height > 900) {
      surface.style.removeProperty('--glass-backdrop')
      return
    }
    const radius = Number.parseFloat(style.borderTopLeftRadius) || 0
    const signature = [rect.width, rect.height, radius, strength].join(':')
    let entry = surfaces.get(surface)
    if (!entry) {
      if (!definitions) {
        const svg = svgElement('svg', { width: 0, height: 0, 'aria-hidden': 'true', focusable: 'false' })
        svg.style.cssText = 'position:fixed;pointer-events:none;overflow:hidden'
        definitions = svgElement('defs', {})
        svg.append(definitions)
        document.body.append(svg)
      }
      const id = `blog-glass-rim-${nextId++}`
      const filter = svgElement('filter', { id, filterUnits: 'userSpaceOnUse', 'color-interpolation-filters': 'sRGB' })
      const image = svgElement('feImage', { result: 'edge-map', preserveAspectRatio: 'none' })
      const displacement = svgElement('feDisplacementMap', { in: 'SourceGraphic', in2: 'edge-map', xChannelSelector: 'R', yChannelSelector: 'G' })
      filter.append(image, displacement)
      definitions.append(filter)
      entry = { id, filter, image, displacement }
      surfaces.set(surface, entry)
    }
    if (entry.signature !== signature) {
      const scale = Math.min(0.5, 640 / rect.width, 320 / rect.height)
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.ceil(rect.width * scale))
      canvas.height = Math.max(1, Math.ceil(rect.height * scale))
      const context = canvas.getContext('2d')
      if (!context) return
      const pixels = context.createImageData(canvas.width, canvas.height)
      const rim = Math.min(24, rect.height / 4)
      for (let row = 0; row < canvas.height; row++) {
        for (let col = 0; col < canvas.width; col++) {
          const px = (col + 0.5) / canvas.width * rect.width - rect.width / 2
          const py = (row + 0.5) / canvas.height * rect.height - rect.height / 2
          const qx = Math.abs(px) - rect.width / 2 + radius
          const qy = Math.abs(py) - rect.height / 2 + radius
          const dx = Math.max(qx, 0), dy = Math.max(qy, 0)
          const length = Math.hypot(dx, dy)
          const distance = length + Math.min(Math.max(qx, qy), 0) - radius
          const bend = Math.pow(Math.max(0, 1 - Math.max(0, -distance) / rim), 2)
          const nx = length ? dx / length * Math.sign(px) : qx > qy ? Math.sign(px) : 0
          const ny = length ? dy / length * Math.sign(py) : qx > qy ? 0 : Math.sign(py)
          const i = (row * canvas.width + col) * 4
          pixels.data[i] = 128 + 127 * nx * bend
          pixels.data[i + 1] = 128 + 127 * ny * bend
          pixels.data[i + 2] = 128
          pixels.data[i + 3] = 255
        }
      }
      context.putImageData(pixels, 0, 0)
      entry.image.setAttribute('href', canvas.toDataURL())
      for (const element of [entry.filter, entry.image]) {
        element.setAttribute('x', '0')
        element.setAttribute('y', '0')
        element.setAttribute('width', rect.width)
        element.setAttribute('height', rect.height)
      }
      entry.displacement.setAttribute('scale', strength)
      entry.signature = signature
    }
    surface.style.setProperty('--glass-backdrop', `blur(var(--glass-blur)) saturate(160%) url("#${entry.id}")`)
  }

  const resize = refracting ? new ResizeObserver(entries => {
    for (const entry of entries) updateRefraction(entry.target)
  }) : null

  const reset = () => {
    cancelAnimationFrame(frame)
    frame = 0
    if (active) {
      active.style.removeProperty('--glass-glow-opacity')
      active.style.removeProperty('--glass-x')
      active.style.removeProperty('--glass-y')
      active = null
    }
  }

  const initialize = () => {
    reset()
    for (const [surface, entry] of surfaces) {
      if (!surface.isConnected) {
        resize.unobserve(surface)
        entry.filter.remove()
        surfaces.delete(surface)
      }
    }
    document.querySelectorAll(selector).forEach(surface => {
      surface.classList.add('liquid-glass')
      if (resize && !surface.matches('.layout > div:first-child:not(.nc)')) resize.observe(surface)
    })
  }

  document.addEventListener('pointermove', event => {
    if (!pointer.matches || reducedMotion.matches || reducedTransparency.matches) return
    const surface = event.target.closest?.('.liquid-glass')
    if (!surface) return reset()
    if (surface !== active) {
      reset()
      active = surface
    }
    x = event.clientX
    y = event.clientY
    if (!frame) frame = requestAnimationFrame(() => {
      frame = 0
      if (!active?.isConnected) return reset()
      const rect = active.getBoundingClientRect()
      active.style.setProperty('--glass-x', `${x - rect.left}px`)
      active.style.setProperty('--glass-y', `${y - rect.top}px`)
      active.style.setProperty('--glass-glow-opacity', '1')
    })
  }, { passive: true })

  document.addEventListener('pointerout', event => {
    if (active && (!event.relatedTarget || !active.contains(event.relatedTarget))) reset()
  }, { passive: true })
  window.addEventListener('scroll', reset, { passive: true })
  window.addEventListener('blur', reset)
  for (const preference of [pointer, reducedMotion, reducedTransparency]) {
    preference.addEventListener('change', () => {
      reset()
      if (resize) document.querySelectorAll('.liquid-glass').forEach(surface => {
        if (!surface.matches('.layout > div:first-child:not(.nc)')) updateRefraction(surface)
      })
    })
  }
  document.addEventListener('pjax:complete', initialize)
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true })
  else initialize()
})()
