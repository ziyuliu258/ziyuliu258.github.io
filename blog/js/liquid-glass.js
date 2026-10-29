/* Glass edge refraction (true optical displacement + chromatic dispersion); no pointer-following glow. */
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
  const reducedTransparency = matchMedia('(prefers-reduced-transparency: reduce)')

  // Chromium supports SVG url(#id) inside backdrop-filter.
  // Build an optical edge displacement + RGB chromatic dispersion filter per card size.
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
    const dispersion = Number.parseFloat(style.getPropertyValue('--glass-dispersion')) || 0.28
    const signature = [Math.round(rect.width), Math.round(rect.height), radius, strength, dispersion].join(':')
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
      const filter = svgElement('filter', {
        id,
        filterUnits: 'userSpaceOnUse',
        primitiveUnits: 'userSpaceOnUse',
        'color-interpolation-filters': 'sRGB'
      })
      const image = svgElement('feImage', { result: 'edge-map', preserveAspectRatio: 'none' })

      // Red, Green, Blue channels refract at slightly different angles (optical dispersion)
      const dispR = svgElement('feDisplacementMap', { in: 'SourceGraphic', in2: 'edge-map', xChannelSelector: 'R', yChannelSelector: 'G', result: 'disp-r' })
      const matR = svgElement('feColorMatrix', {
        in: 'disp-r',
        type: 'matrix',
        values: '1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0',
        result: 'ch-r'
      })

      const dispG = svgElement('feDisplacementMap', { in: 'SourceGraphic', in2: 'edge-map', xChannelSelector: 'R', yChannelSelector: 'G', result: 'disp-g' })
      const matG = svgElement('feColorMatrix', {
        in: 'disp-g',
        type: 'matrix',
        values: '0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0',
        result: 'ch-g'
      })

      const dispB = svgElement('feDisplacementMap', { in: 'SourceGraphic', in2: 'edge-map', xChannelSelector: 'R', yChannelSelector: 'G', result: 'disp-b' })
      const matB = svgElement('feColorMatrix', {
        in: 'disp-b',
        type: 'matrix',
        values: '0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0',
        result: 'ch-b'
      })

      const blendRG = svgElement('feBlend', { in: 'ch-r', in2: 'ch-g', mode: 'screen', result: 'ch-rg' })
      const blendRGB = svgElement('feBlend', { in: 'ch-rg', in2: 'ch-b', mode: 'screen' })

      filter.append(image, dispR, matR, dispG, matG, dispB, matB, blendRG, blendRGB)
      definitions.append(filter)
      entry = { id, filter, image, dispR, dispG, dispB }
      surfaces.set(surface, entry)
    }
    if (entry.signature !== signature) {
      const w = Math.max(1, Math.round(rect.width))
      const h = Math.max(1, Math.round(rect.height))
      const scale = Math.min(0.5, 640 / w, 320 / h)
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.ceil(w * scale))
      canvas.height = Math.max(1, Math.ceil(h * scale))
      const context = canvas.getContext('2d')
      if (!context) return
      const pixels = context.createImageData(canvas.width, canvas.height)
      const rim = Math.min(28, h / 3.2)
      for (let row = 0; row < canvas.height; row++) {
        for (let col = 0; col < canvas.width; col++) {
          const px = (col + 0.5) / canvas.width * w - w / 2
          const py = (row + 0.5) / canvas.height * h - h / 2
          const qx = Math.abs(px) - w / 2 + radius
          const qy = Math.abs(py) - h / 2 + radius
          const dx = Math.max(qx, 0), dy = Math.max(qy, 0)
          const length = Math.hypot(dx, dy)
          const distance = length + Math.min(Math.max(qx, qy), 0) - radius
          const bend = Math.pow(Math.max(0, 1 - Math.max(0, -distance) / rim), 2.2)
          const nx = length ? dx / length * Math.sign(px) : qx > qy ? Math.sign(px) : 0
          const ny = length ? dy / length * Math.sign(py) : qx > qy ? 0 : Math.sign(py)
          const i = (row * canvas.width + col) * 4
          pixels.data[i] = Math.round(128 + 127 * nx * bend)
          pixels.data[i + 1] = Math.round(128 + 127 * ny * bend)
          pixels.data[i + 2] = 128
          pixels.data[i + 3] = 255
        }
      }
      context.putImageData(pixels, 0, 0)
      const dataUrl = canvas.toDataURL()
      entry.image.setAttribute('href', dataUrl)
      entry.image.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', dataUrl)
      for (const element of [entry.filter, entry.image]) {
        element.setAttribute('x', '0')
        element.setAttribute('y', '0')
        element.setAttribute('width', w)
        element.setAttribute('height', h)
      }
      entry.dispR.setAttribute('scale', (strength * (1 + dispersion)).toFixed(2))
      entry.dispG.setAttribute('scale', strength.toFixed(2))
      entry.dispB.setAttribute('scale', (strength * (1 - dispersion)).toFixed(2))
      entry.signature = signature
    }
    surface.style.setProperty('--glass-backdrop', `url("#${entry.id}") blur(var(--glass-blur)) saturate(var(--glass-saturate, 180%))`)
  }

  const resize = refracting ? new ResizeObserver(entries => {
    for (const entry of entries) updateRefraction(entry.target)
  }) : null

  const initialize = () => {
    for (const [surface, entry] of surfaces) {
      if (!surface.isConnected) {
        resize?.unobserve(surface)
        entry.filter.remove()
        surfaces.delete(surface)
      }
    }
    document.querySelectorAll(selector).forEach(surface => {
      surface.classList.add('liquid-glass')
      if (resize && !surface.matches('.layout > div:first-child:not(.nc)')) resize.observe(surface)
    })
  }

  for (const preference of [pointer, reducedTransparency]) {
    preference.addEventListener('change', () => {
      if (resize) document.querySelectorAll('.liquid-glass').forEach(surface => {
        if (!surface.matches('.layout > div:first-child:not(.nc)')) updateRefraction(surface)
      })
    })
  }
  document.addEventListener('pjax:complete', initialize)
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true })
  else initialize()
})()
