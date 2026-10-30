/* Port of jaxparrow07/liquidglass-kde-widgets (LiquidGlass.qml + liquidglass.frag):
 * - Squircle superellipse SDF & analytic outward normal (sceneSDFAndNormal)
 * - Snell-on-a-dome edge refraction: sinThetaI = (1-t)^2, thetaT = asin(sinThetaI / IOR), edgeMag = tan(thetaI - thetaT)
 * - RGB chromatic dispersion along -ndir inside the edge band
 * - Static cornerSpecular (TL primary + BR antipodal at 65% with exponential taper) + directional edgeSpec lip
 * - Performance: shared filter + texture cache by card geometry ( identical-sized post cards share 1 SVG filter & 1 Canvas pass )
 * - Sidebar widgets always get the effect.
 * - Homepage cards and the series directory get it only when those lists
 *   carry .nc, which _config.butterfly.yml index_column_glass: true adds.
 */
(() => {
  'use strict'

  if (window.__blogLiquidGlass) return
  window.__blogLiquidGlass = true

  const selector = [
    '#recent-posts.nc .recent-post-item',
    '#recent-posts.nc .home-announcement',
    '#aside-content .card-widget'
  ].join(', ')

  const pointer = matchMedia('(hover: hover) and (pointer: fine)')
  const reducedTransparency = matchMedia('(prefers-reduced-transparency: reduce)')

  const chromium = /Chrome\/|Chromium\//.test(navigator.userAgent)
  const refracting = chromium && CSS.supports('backdrop-filter', 'url("#glass")') && 'ResizeObserver' in window
  // Cache shared SVG filters and specular overlays by geometry signature so 10 post cards only build 1 filter!
  const sharedFilters = new Map()
  const surfaceSignature = new WeakMap()
  const ns = 'http://www.w3.org/2000/svg'
  let definitions
  let nextId = 0

  function svgElement(tag, attributes) {
    const element = document.createElementNS(ns, tag)
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value)
    return element
  }

  // Exact port of sceneSDFAndNormal(vec2 p) from liquidglass.frag
  function sceneSDFAndNormal(px, py, halfW, halfH, radius, roundness) {
    const n = Math.max(roundness, 2.0)
    const r = Math.min(Math.max(radius, 0.0), Math.min(halfW, halfH))

    const qxRaw = Math.abs(px) - halfW + r
    const qyRaw = Math.abs(py) - halfH + r
    const qx = Math.max(qxRaw, 0.0)
    const qy = Math.max(qyRaw, 0.0)

    let d
    let nx
    let ny

    if (qx <= 0.0 && qy <= 0.0) {
      d = Math.max(qxRaw, qyRaw) - r
      if (qxRaw >= qyRaw) {
        nx = 1.0
        ny = 0.0
      } else {
        nx = 0.0
        ny = 1.0
      }
    } else if (qx === 0.0) {
      d = qy - r
      nx = 0.0
      ny = 1.0
    } else if (qy === 0.0) {
      d = qx - r
      nx = 1.0
      ny = 0.0
    } else if (n === 2.0) {
      // Fast path for circular corners (avoids Math.pow per pixel)
      const arc = Math.hypot(qx, qy)
      const invArc = 1.0 / Math.max(arc, 1e-4)
      d = arc - r
      nx = qx * invArc
      ny = qy * invArc
    } else {
      const qxn = Math.pow(qx, n)
      const qyn = Math.pow(qy, n)
      const arc = Math.pow(qxn + qyn, 1.0 / n)
      const gx = Math.pow(qx / arc, n - 1.0)
      const gy = Math.pow(qy / arc, n - 1.0)
      const gradLen = Math.max(Math.hypot(gx, gy), 1e-3)
      d = (arc - r) / gradLen
      nx = gx / gradLen
      ny = gy / gradLen
    }

    nx *= px >= 0 ? 1.0 : -1.0
    ny *= py >= 0 ? 1.0 : -1.0
    return { d, nx, ny }
  }

  function smoothstep(edge0, edge1, x) {
    const t = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0.0), 1.0)
    return t * t * (3.0 - 2.0 * t)
  }

  function getOrBuildSharedFilter(w, h, radius, refractThickness, refractIOR, refractScale, chromaStrength, specStrength) {
    const signature = [w, h, radius, refractThickness, refractIOR, refractScale, chromaStrength, specStrength].join(':')
    let shared = sharedFilters.get(signature)
    if (shared) return shared

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
      x: '0',
      y: '0',
      width: w,
      height: h,
      filterUnits: 'userSpaceOnUse',
      primitiveUnits: 'userSpaceOnUse',
      'color-interpolation-filters': 'sRGB'
    })
    const image = svgElement('feImage', {
      x: '0',
      y: '0',
      width: w,
      height: h,
      result: 'edge-map',
      preserveAspectRatio: 'none'
    })

    // Peak Snell deflection occurs at t = 0 (sinThetaI = 1.0)
    const thetaI0 = Math.asin(1.0)
    const thetaT0 = Math.asin(Math.min(1.0 / refractIOR, 1.0))
    const maxEdgeMag = Math.max(Math.tan(thetaI0 - thetaT0), 1e-4)
    const maxDisplacePx = maxEdgeMag * refractScale
    const maxChromaPx = chromaStrength * refractThickness * 0.35

    // Pre-build 256-entry lookup table for Snell curve so inner pixel loop has ZERO trig calls (asin/tan)
    const snellLUT = new Float32Array(256)
    for (let i = 0; i < 256; i++) {
      const t = i / 255
      const sinThetaI = (1.0 - t) * (1.0 - t)
      const thetaI = Math.asin(Math.min(Math.max(sinThetaI, 0.0), 1.0))
      const sinThetaT = sinThetaI / refractIOR
      const thetaT = Math.asin(Math.min(Math.max(sinThetaT, 0.0), 1.0))
      snellLUT[i] = Math.tan(thetaI - thetaT) / maxEdgeMag
    }

    const dispScale = Math.min(0.5, 480 / w, 240 / h)
    const dispCanvas = document.createElement('canvas')
    dispCanvas.width = Math.max(1, Math.ceil(w * dispScale))
    dispCanvas.height = Math.max(1, Math.ceil(h * dispScale))
    const dispCtx = dispCanvas.getContext('2d')
    const dispPixels = dispCtx.createImageData(dispCanvas.width, dispCanvas.height)
    // Pre-fill neutral (128, 128, 128, 255) so interior pixels can be skipped in O(1)
    const data32 = new Uint32Array(dispPixels.data.buffer)
    data32.fill(0xff808080)

    const halfW = w * 0.5
    const halfH = h * 0.5
    const innerSkipW = halfW - Math.max(radius, refractThickness) - 2
    const innerSkipH = halfH - Math.max(radius, refractThickness) - 2

    for (let row = 0; row < dispCanvas.height; row++) {
      const py = (row + 0.5) / dispCanvas.height * h - halfH
      const inYInterior = Math.abs(py) < innerSkipH
      for (let col = 0; col < dispCanvas.width; col++) {
        const px = (col + 0.5) / dispCanvas.width * w - halfW
        if (inYInterior && Math.abs(px) < innerSkipW) continue

        const { d, nx, ny } = sceneSDFAndNormal(px, py, halfW, halfH, radius, 2.0)
        const depthPx = -d

        if (depthPx >= 0.0 && depthPx < refractThickness) {
          const lutIdx = Math.min(255, Math.max(0, (depthPx / refractThickness * 255) | 0))
          const normMag = snellLUT[lutIdx]
          const vx = -nx * normMag
          const vy = -ny * normMag
          const idx = (row * dispCanvas.width + col) * 4
          dispPixels.data[idx] = Math.min(255, Math.max(0, (128 + 127 * vx + 0.5) | 0))
          dispPixels.data[idx + 1] = Math.min(255, Math.max(0, (128 + 127 * vy + 0.5) | 0))
        }
      }
    }
    dispCtx.putImageData(dispPixels, 0, 0)
    const dispUrl = dispCanvas.toDataURL()
    image.setAttribute('href', dispUrl)
    image.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', dispUrl)

    const scaleG = 2.0 * maxDisplacePx
    const scaleR = 2.0 * (maxDisplacePx + maxChromaPx)
    const scaleB = 2.0 * Math.max(0, maxDisplacePx - maxChromaPx)

    if (chromaStrength > 0.01) {
      // Lightweight 2-pass R vs GB chromatic dispersion (cuts SVG filter nodes in half vs 3-pass)
      const dispR = svgElement('feDisplacementMap', {
        in: 'SourceGraphic',
        in2: 'edge-map',
        scale: scaleR.toFixed(1),
        xChannelSelector: 'R',
        yChannelSelector: 'G',
        result: 'disp-r'
      })
      const matR = svgElement('feColorMatrix', {
        in: 'disp-r',
        type: 'matrix',
        values: '1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0',
        result: 'ch-r'
      })
      const dispGB = svgElement('feDisplacementMap', {
        in: 'SourceGraphic',
        in2: 'edge-map',
        scale: scaleB.toFixed(1),
        xChannelSelector: 'R',
        yChannelSelector: 'G',
        result: 'disp-gb'
      })
      const matGB = svgElement('feColorMatrix', {
        in: 'disp-gb',
        type: 'matrix',
        values: '0 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 1 0',
        result: 'ch-gb'
      })
      const blend = svgElement('feBlend', { in: 'ch-r', in2: 'ch-gb', mode: 'screen' })
      filter.append(image, dispR, matR, dispGB, matGB, blend)
    } else {
      const disp = svgElement('feDisplacementMap', {
        in: 'SourceGraphic',
        in2: 'edge-map',
        scale: scaleG.toFixed(1),
        xChannelSelector: 'R',
        yChannelSelector: 'G'
      })
      filter.append(image, disp)
    }

    definitions.append(filter)

    // 2. Build static cornerSpec + edgeSpec overlay (only iterates border pixels, skips interior)
    let specUrl = 'none'
    if (specStrength > 0) {
      const specScale = Math.min(1.0, 720 / w, 360 / h)
      const specCanvas = document.createElement('canvas')
      specCanvas.width = Math.max(1, Math.round(w * specScale))
      specCanvas.height = Math.max(1, Math.round(h * specScale))
      const specCtx = specCanvas.getContext('2d')
      if (specCtx) {
        const specPixels = specCtx.createImageData(specCanvas.width, specCanvas.height)
        const MAX_STROKE_PX = 2.6
        const FEATHER_PX = 1.6
        const SECONDARY_INT = 0.65
        const maxSpecDepth = MAX_STROKE_PX + FEATHER_PX + 1.0
        const specSkipW = halfW - Math.max(radius, maxSpecDepth) - 2
        const specSkipH = halfH - Math.max(radius, maxSpecDepth) - 2

        const lightX = -halfW * 1.2
        const lightY = -halfH * 1.2
        const antiX = -lightX
        const antiY = -lightY
        const taper = Math.max(w, h) * 0.7
        const lightDirLen = Math.hypot(-0.45, -0.90)
        const lightDirX = -0.45 / lightDirLen
        const lightDirY = -0.90 / lightDirLen

        for (let row = 0; row < specCanvas.height; row++) {
          const py = (row + 0.5) / specCanvas.height * h - halfH
          const inYSpecInterior = Math.abs(py) < specSkipH
          for (let col = 0; col < specCanvas.width; col++) {
            const px = (col + 0.5) / specCanvas.width * w - halfW
            if (inYSpecInterior && Math.abs(px) < specSkipW) continue

            const { d, nx, ny } = sceneSDFAndNormal(px, py, halfW, halfH, radius, 2.0)
            const depthPx = -d

            if (d > 0.5 || depthPx > maxSpecDepth) continue
            const outerMask = 1.0 - smoothstep(-0.5, 0.5, d)

            const distPrimary = Math.hypot(px - lightX, py - lightY)
            const distSecondary = Math.hypot(px - antiX, py - antiY)
            const primaryAtt = Math.exp(-distPrimary / taper)
            const secondaryAtt = Math.exp(-distSecondary / taper) * SECONDARY_INT
            const tPx = Math.max(primaryAtt, secondaryAtt) * MAX_STROKE_PX
            const stroke = 1.0 - smoothstep(tPx - FEATHER_PX, tPx, Math.max(depthPx, 0.0))
            const cornerI = stroke * specStrength * 0.62

            const lip = 1.0 - smoothstep(0.0, 2.5, Math.max(depthPx, 0.0))
            const dotProduct = nx * lightDirX + ny * lightDirY
            const facing = 0.35 + 0.65 * Math.min(Math.max(dotProduct * 0.5 + 0.5, 0.0), 1.0)
            const edgeI = lip * facing * specStrength * 0.14

            const totalI = Math.min(1.0, (cornerI + edgeI) * outerMask)
            if (totalI <= 0.004) continue

            const idx = (row * specCanvas.width + col) * 4
            specPixels.data[idx] = 255
            specPixels.data[idx + 1] = 250
            specPixels.data[idx + 2] = 240
            specPixels.data[idx + 3] = Math.min(255, (totalI * 255 + 0.5) | 0)
          }
        }
        specCtx.putImageData(specPixels, 0, 0)
        specUrl = `url("${specCanvas.toDataURL()}")`
      }
    }

    shared = { id, filter, specUrl, signature }
    sharedFilters.set(signature, shared)
    return shared
  }

  function updateRefraction(surface) {
    const rootClass = document.documentElement.classList
    if (rootClass.contains('aside-motion') || rootClass.contains('aside-glass-pause')) return
    if (!pointer.matches || reducedTransparency.matches) {
      surface.style.removeProperty('--glass-backdrop')
      surface.style.removeProperty('--glass-spec-image')
      surface.removeAttribute('data-shader-glass')
      return
    }
    const rect = surface.getBoundingClientRect()
    const style = getComputedStyle(surface)
    const refractThickness = Number.parseFloat(style.getPropertyValue('--glass-refract-thickness')) || 35
    const refractIOR = Number.parseFloat(style.getPropertyValue('--glass-refract-ior')) || 1.70
    const refractScale = Number.parseFloat(style.getPropertyValue('--glass-refract-scale')) || 65
    const chromaStrength = Number.parseFloat(style.getPropertyValue('--glass-chroma-strength')) || 0.35
    const specStrength = Number.parseFloat(style.getPropertyValue('--glass-spec-strength')) || 0.70
    const radius = Number.parseFloat(style.borderTopLeftRadius) || 0

    if (!refractScale || !rect.width || !rect.height || rect.height > 900) {
      surface.style.removeProperty('--glass-backdrop')
      surface.style.removeProperty('--glass-spec-image')
      surface.removeAttribute('data-shader-glass')
      return
    }

    const w = Math.max(1, Math.round(rect.width))
    const h = Math.max(1, Math.round(rect.height))
    const signature = [w, h, radius, refractThickness, refractIOR, refractScale, chromaStrength, specStrength].join(':')

    if (surfaceSignature.get(surface) === signature) return
    surfaceSignature.set(surface, signature)

    const shared = getOrBuildSharedFilter(w, h, radius, refractThickness, refractIOR, refractScale, chromaStrength, specStrength)
    surface.style.setProperty('--glass-backdrop', `blur(var(--glass-blur)) saturate(var(--glass-saturate, 165%)) url("#${shared.id}")`)
    surface.style.setProperty('--glass-spec-image', shared.specUrl)
    surface.setAttribute('data-shader-glass', '1')
  }

  const resize = refracting ? new ResizeObserver(entries => {
    for (const entry of entries) updateRefraction(entry.target)
  }) : null

  const initialize = () => {
    document.querySelectorAll(selector).forEach(surface => {
      surface.classList.add('liquid-glass')
      if (resize) resize.observe(surface)
    })
  }

  for (const preference of [pointer, reducedTransparency]) {
    preference.addEventListener('change', () => {
      if (resize) document.querySelectorAll('.liquid-glass').forEach(surface => {
        surfaceSignature.delete(surface)
        updateRefraction(surface)
      })
    })
  }
  document.addEventListener('blog:aside-motion-end', () => {
    if (!resize) return
    document.querySelectorAll('.liquid-glass').forEach(surface => updateRefraction(surface))
  })
  document.addEventListener('pjax:complete', initialize)
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true })
  else initialize()
})()
