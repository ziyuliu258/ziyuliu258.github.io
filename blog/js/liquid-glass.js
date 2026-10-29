/* Port of jaxparrow07/liquidglass-kde-widgets (LiquidGlass.qml + liquidglass.frag):
 * - Squircle superellipse SDF & analytic outward normal (sceneSDFAndNormal)
 * - Snell-on-a-dome edge refraction: sinThetaI = (1-t)^2, thetaT = asin(sinThetaI / IOR), edgeMag = tan(thetaI - thetaT)
 * - RGB chromatic dispersion along -ndir inside the edge band
 * - Static cornerSpecular (TL primary + BR antipodal at 65% with exponential taper) + directional edgeSpec lip
 * - No pointer-following spotlight glow
 */
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

  function updateRefraction(surface) {
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
    const roundness = Number.parseFloat(style.getPropertyValue('--glass-roundness')) || 2.2
    const radius = Number.parseFloat(style.borderTopLeftRadius) || 26

    if (!refractScale || !rect.width || !rect.height || rect.height > 900) {
      surface.style.removeProperty('--glass-backdrop')
      surface.style.removeProperty('--glass-spec-image')
      surface.removeAttribute('data-shader-glass')
      return
    }

    const w = Math.max(1, Math.round(rect.width))
    const h = Math.max(1, Math.round(rect.height))
    const signature = [w, h, radius, roundness, refractThickness, refractIOR, refractScale, chromaStrength, specStrength].join(':')

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

      // Red, Green, Blue channels refract along -ndir with chromatic dispersion (liquidglass.frag lines 206-212)
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
      // Peak Snell deflection occurs at t = 0 (sinThetaI = 1.0)
      const thetaI0 = Math.asin(1.0)
      const thetaT0 = Math.asin(Math.min(1.0 / refractIOR, 1.0))
      const maxEdgeMag = Math.max(Math.tan(thetaI0 - thetaT0), 1e-4)
      const maxDisplacePx = maxEdgeMag * refractScale
      const maxChromaPx = chromaStrength * refractThickness * 0.35

      // 1. Build displacement map for Snell-on-a-dome refraction
      const dispScale = Math.min(0.5, 640 / w, 320 / h)
      const dispCanvas = document.createElement('canvas')
      dispCanvas.width = Math.max(1, Math.ceil(w * dispScale))
      dispCanvas.height = Math.max(1, Math.ceil(h * dispScale))
      const dispCtx = dispCanvas.getContext('2d')
      if (!dispCtx) return
      const dispPixels = dispCtx.createImageData(dispCanvas.width, dispCanvas.height)
      const halfW = w * 0.5
      const halfH = h * 0.5

      for (let row = 0; row < dispCanvas.height; row++) {
        for (let col = 0; col < dispCanvas.width; col++) {
          const px = (col + 0.5) / dispCanvas.width * w - halfW
          const py = (row + 0.5) / dispCanvas.height * h - halfH
          // Use CSS rounded-box (n=2.0) for the displacement boundary so it aligns 1:1 with CSS border-radius clipping
          const { d, nx, ny } = sceneSDFAndNormal(px, py, halfW, halfH, radius, 2.0)
          const depthPx = -d

          let normMag = 0.0
          if (depthPx > -2.0 && depthPx < refractThickness) {
            const t = Math.min(Math.max(depthPx / refractThickness, 0.0), 1.0)
            const sinThetaI = (1.0 - t) * (1.0 - t)
            const thetaI = Math.asin(Math.min(Math.max(sinThetaI, 0.0), 1.0))
            const sinThetaT = sinThetaI / refractIOR
            const thetaT = Math.asin(Math.min(Math.max(sinThetaT, 0.0), 1.0))
            const edgeMag = Math.tan(thetaI - thetaT)
            normMag = edgeMag / maxEdgeMag
          }

          // Displace inward (-ndir), matching displacePx = -ndir * edgeMag * refractScale
          const vx = -nx * normMag
          const vy = -ny * normMag
          const idx = (row * dispCanvas.width + col) * 4
          dispPixels.data[idx] = Math.min(255, Math.max(0, Math.round(128 + 127 * vx)))
          dispPixels.data[idx + 1] = Math.min(255, Math.max(0, Math.round(128 + 127 * vy)))
          dispPixels.data[idx + 2] = 128
          dispPixels.data[idx + 3] = 255
        }
      }
      dispCtx.putImageData(dispPixels, 0, 0)
      const dispUrl = dispCanvas.toDataURL()
      entry.image.setAttribute('href', dispUrl)
      entry.image.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', dispUrl)

      for (const element of [entry.filter, entry.image]) {
        element.setAttribute('x', '0')
        element.setAttribute('y', '0')
        element.setAttribute('width', w)
        element.setAttribute('height', h)
      }

      // 2.0 * scale because feDisplacementMap maps [0..1] around 0.5 -> [-0.5..+0.5] * scale
      const scaleG = 2.0 * maxDisplacePx
      const scaleR = 2.0 * (maxDisplacePx + maxChromaPx)
      const scaleB = 2.0 * Math.max(0, maxDisplacePx - maxChromaPx)
      entry.dispR.setAttribute('scale', scaleR.toFixed(2))
      entry.dispG.setAttribute('scale', scaleG.toFixed(2))
      entry.dispB.setAttribute('scale', scaleB.toFixed(2))

      // 2. Build static cornerSpec + edgeSpec overlay matching liquidglass.frag (lines 125-162)
      const specScale = Math.min(1.0, 960 / w, 480 / h)
      const specCanvas = document.createElement('canvas')
      specCanvas.width = Math.max(1, Math.ceil(w * specScale))
      specCanvas.height = Math.max(1, Math.ceil(h * specScale))
      const specCtx = specCanvas.getContext('2d')
      if (specCtx && specStrength > 0) {
        const specPixels = specCtx.createImageData(specCanvas.width, specCanvas.height)
        const MAX_STROKE_PX = 3.2
        const FEATHER_PX = 2.2
        const SECONDARY_INT = 0.65
        // In screen coordinates (y down), top-left is (-halfW, -halfH)
        const lightX = -halfW * 1.2
        const lightY = -halfH * 1.2
        const antiX = -lightX
        const antiY = -lightY
        const taper = Math.max(w, h) * 0.7
        const lightDirLen = Math.hypot(-0.45, -0.90)
        const lightDirX = -0.45 / lightDirLen
        const lightDirY = -0.90 / lightDirLen

        for (let row = 0; row < specCanvas.height; row++) {
          for (let col = 0; col < specCanvas.width; col++) {
            const px = (col + 0.5) / specCanvas.width * w - halfW
            const py = (row + 0.5) / specCanvas.height * h - halfH
            const { d, nx, ny } = sceneSDFAndNormal(px, py, halfW, halfH, radius, 2.0)
            const depthPx = -d

            if (depthPx < -0.5 || depthPx > MAX_STROKE_PX + FEATHER_PX + 1.0) continue

            // cornerSpec
            const distPrimary = Math.hypot(px - lightX, py - lightY)
            const distSecondary = Math.hypot(px - antiX, py - antiY)
            const primaryAtt = Math.exp(-distPrimary / taper)
            const secondaryAtt = Math.exp(-distSecondary / taper) * SECONDARY_INT
            const tPx = Math.max(primaryAtt, secondaryAtt) * MAX_STROKE_PX
            const stroke = 1.0 - smoothstep(tPx - FEATHER_PX, tPx, depthPx)
            const cornerI = stroke * specStrength * 0.62

            // edgeSpec
            const lip = 1.0 - smoothstep(0.0, 3.0, Math.max(depthPx, 0.0))
            const dotProduct = nx * lightDirX + ny * lightDirY
            const facing = 0.35 + 0.65 * Math.min(Math.max(dotProduct * 0.5 + 0.5, 0.0), 1.0)
            const edgeI = lip * facing * specStrength * 0.14

            const totalI = Math.min(1.0, cornerI + edgeI)
            if (totalI <= 0.004) continue

            const idx = (row * specCanvas.width + col) * 4
            // vec3(1.0, 0.98, 0.94) warm-white specular from liquidglass.frag
            specPixels.data[idx] = 255
            specPixels.data[idx + 1] = 250
            specPixels.data[idx + 2] = 240
            specPixels.data[idx + 3] = Math.min(255, Math.round(totalI * 255))
          }
        }
        specCtx.putImageData(specPixels, 0, 0)
        entry.specUrl = `url("${specCanvas.toDataURL()}")`
      } else {
        entry.specUrl = 'none'
      }

      entry.signature = signature
    }

    // Important: blur FIRST, then displace via url(#id), just like LiquidGlass.qml (Kawase blur -> glassShader)
    surface.style.setProperty('--glass-backdrop', `blur(var(--glass-blur)) saturate(var(--glass-saturate, 165%)) url("#${entry.id}")`)
    surface.style.setProperty('--glass-spec-image', entry.specUrl)
    surface.setAttribute('data-shader-glass', '1')
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
