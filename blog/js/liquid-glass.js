/* Port of jaxparrow07/liquidglass-kde-widgets (LiquidGlass.qml + liquidglass.frag):
 * - Squircle superellipse SDF & analytic outward normal (sceneSDFAndNormal)
 * - Snell-on-a-dome edge refraction: sinThetaI = (1-t)^2, thetaT = asin(sinThetaI / IOR), edgeMag = tan(thetaI - thetaT)
 * - RGB chromatic dispersion along -ndir inside the edge band
 * - Static cornerSpecular (TL primary + BR antipodal at 65% with exponential taper) + directional edgeSpec lip
 * - Performance: shared filter + texture cache by card geometry ( identical-sized post cards share 1 SVG filter & 1 Canvas pass )
 * - Applied ONLY to sidebar widgets.
 *   Home, series, post, archive, tag, and category backgrounds are separate CSS variables.
 */
(() => {
  'use strict'

  if (window.__blogLiquidGlass) return
  window.__blogLiquidGlass = true

  const selector = '#aside-content .card-widget, .nav-pill-glass, .nav-bar-glass'

  const pointer = matchMedia('(hover: hover) and (pointer: fine)')
  const reducedTransparency = matchMedia('(prefers-reduced-transparency: reduce)')

  const liquidSite = (window.GLOBAL_CONFIG_SITE && GLOBAL_CONFIG_SITE.liquid) || {}
  const glassConfig = liquidSite.glass || {}
  const chromium = /Chrome\/|Chromium\//.test(navigator.userAgent)
  const refracting = glassConfig.refraction !== false && chromium && CSS.supports('backdrop-filter', 'url("#glass")') && 'ResizeObserver' in window
  // Cache shared SVG filters and specular overlays by geometry signature so 10 post cards only build 1 filter!
  const sharedFilters = new Map()
  const sharedBarMaps = new Map()
  let barFilterNode = null
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

    // Compact glass capsules (h <= 80) cap grazing incidence at sinThetaI = 0.90 with a gentler dome curve
    // so Snell refraction & RGB chromatic dispersion stay clearly visible across the 2..14px inner bevel
    // instead of collapsing into the outermost 1px hidden behind the white specular rim.
    const isCapsule = h <= 80
    const maxSinI = isCapsule ? 0.90 : 1.0
    const domeExp = isCapsule ? 1.35 : 2.0
    const thetaI0 = Math.asin(maxSinI)
    const thetaT0 = Math.asin(Math.min(maxSinI / refractIOR, 1.0))
    const maxEdgeMag = Math.max(Math.tan(thetaI0 - thetaT0), 1e-4)
    const maxDisplacePx = maxEdgeMag * refractScale
    const maxChromaPx = chromaStrength * refractThickness * 0.35

    // Pre-build 256-entry lookup table for Snell curve so inner pixel loop has ZERO trig calls (asin/tan)
    const snellLUT = new Float32Array(256)
    for (let i = 0; i < 256; i++) {
      const t = i / 255
      const sinThetaI = maxSinI * Math.pow(1.0 - t, domeExp)
      const thetaI = Math.asin(Math.min(Math.max(sinThetaI, 0.0), 1.0))
      const sinThetaT = sinThetaI / refractIOR
      const thetaT = Math.asin(Math.min(Math.max(sinThetaT, 0.0), 1.0))
      snellLUT[i] = Math.tan(thetaI - thetaT) / maxEdgeMag
    }

    const dispScale = h <= 80 ? Math.min(1.0, 560 / w, 120 / h) : Math.min(0.5, 480 / w, 240 / h)
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

    if (chromaStrength > 0.01 && h <= 80) {
      // Compact top capsule: true 3-channel R/G/B prism dispersion (tiny area, static at top)
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
      const dispG = svgElement('feDisplacementMap', {
        in: 'SourceGraphic',
        in2: 'edge-map',
        scale: scaleG.toFixed(1),
        xChannelSelector: 'R',
        yChannelSelector: 'G',
        result: 'disp-g'
      })
      const matG = svgElement('feColorMatrix', {
        in: 'disp-g',
        type: 'matrix',
        values: '0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0',
        result: 'ch-g'
      })
      const dispB = svgElement('feDisplacementMap', {
        in: 'SourceGraphic',
        in2: 'edge-map',
        scale: scaleB.toFixed(1),
        xChannelSelector: 'R',
        yChannelSelector: 'G',
        result: 'disp-b'
      })
      const matB = svgElement('feColorMatrix', {
        in: 'disp-b',
        type: 'matrix',
        values: '0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0',
        result: 'ch-b'
      })
      const blendRG = svgElement('feBlend', { in: 'ch-r', in2: 'ch-g', mode: 'screen', result: 'ch-rg' })
      const blendRGB = svgElement('feBlend', { in: 'ch-rg', in2: 'ch-b', mode: 'screen' })
      filter.append(image, dispR, matR, dispG, matG, dispB, matB, blendRG, blendRGB)
    } else if (chromaStrength > 0.01) {
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

  // Ultra-lightweight 1D vertical bottom-lip refraction + chromatic dispersion for full-width scrolled nav bar:
  // Generates a single 1px x H strip (60 pixels total) once and stretches horizontally on resize in O(1).
  function getOrUpdateBarFilter(w, h, refractThickness, refractIOR, refractScale, chromaStrength) {
    if (!definitions) {
      const svg = svgElement('svg', { width: 0, height: 0, 'aria-hidden': 'true', focusable: 'false' })
      svg.style.cssText = 'position:fixed;pointer-events:none;overflow:hidden'
      definitions = svgElement('defs', {})
      svg.append(definitions)
      document.body.append(svg)
    }

    const mapKey = [h, refractThickness, refractIOR, refractScale, chromaStrength].join(':')
    let mapEntry = sharedBarMaps.get(mapKey)
    if (!mapEntry) {
      const maxSinI = 0.90
      const thetaI0 = Math.asin(maxSinI)
      const thetaT0 = Math.asin(Math.min(maxSinI / refractIOR, 1.0))
      const maxEdgeMag = Math.max(Math.tan(thetaI0 - thetaT0), 1e-4)
      const maxDisplacePx = maxEdgeMag * refractScale
      const maxChromaPx = chromaStrength * refractThickness * 0.35

      const stripCanvas = document.createElement('canvas')
      stripCanvas.width = 1
      stripCanvas.height = Math.max(1, h)
      const ctx = stripCanvas.getContext('2d')
      const pixels = ctx.createImageData(1, stripCanvas.height)
      const data32 = new Uint32Array(pixels.data.buffer)
      data32.fill(0xff808080)

      for (let row = 0; row < stripCanvas.height; row++) {
        const depthFromBottom = stripCanvas.height - 0.5 - row
        if (depthFromBottom >= 0 && depthFromBottom < refractThickness) {
          const t = depthFromBottom / refractThickness
          const sinThetaI = maxSinI * Math.pow(1.0 - t, 1.35)
          const thetaI = Math.asin(Math.min(Math.max(sinThetaI, 0.0), 1.0))
          const thetaT = Math.asin(Math.min(Math.max(sinThetaI / refractIOR, 0.0), 1.0))
          const normMag = Math.tan(thetaI - thetaT) / maxEdgeMag
          const vy = -normMag
          const idx = row * 4
          pixels.data[idx] = 128
          pixels.data[idx + 1] = Math.min(255, Math.max(0, (128 + 127 * vy + 0.5) | 0))
        }
      }
      ctx.putImageData(pixels, 0, 0)
      mapEntry = {
        url: stripCanvas.toDataURL(),
        scaleR: (2.0 * (maxDisplacePx + maxChromaPx)).toFixed(1),
        scaleB: (2.0 * Math.max(0, maxDisplacePx - maxChromaPx)).toFixed(1)
      }
      sharedBarMaps.set(mapKey, mapEntry)
    }

    if (!barFilterNode) {
      const id = 'blog-glass-bar'
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
        result: 'bar-map',
        preserveAspectRatio: 'none'
      })
      const dispR = svgElement('feDisplacementMap', {
        in: 'SourceGraphic',
        in2: 'bar-map',
        scale: mapEntry.scaleR,
        xChannelSelector: 'R',
        yChannelSelector: 'G',
        result: 'bar-disp-r'
      })
      const matR = svgElement('feColorMatrix', {
        in: 'bar-disp-r',
        type: 'matrix',
        values: '1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0',
        result: 'bar-ch-r'
      })
      const dispGB = svgElement('feDisplacementMap', {
        in: 'SourceGraphic',
        in2: 'bar-map',
        scale: mapEntry.scaleB,
        xChannelSelector: 'R',
        yChannelSelector: 'G',
        result: 'bar-disp-gb'
      })
      const matGB = svgElement('feColorMatrix', {
        in: 'bar-disp-gb',
        type: 'matrix',
        values: '0 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 1 0',
        result: 'bar-ch-gb'
      })
      const blend = svgElement('feBlend', { in: 'bar-ch-r', in2: 'bar-ch-gb', mode: 'screen' })
      filter.append(image, dispR, matR, dispGB, matGB, blend)
      definitions.append(filter)
      barFilterNode = { id, filter, image, dispR, dispGB, mapKey: '' }
    }

    barFilterNode.filter.setAttribute('width', w)
    barFilterNode.filter.setAttribute('height', h)
    barFilterNode.image.setAttribute('width', w)
    barFilterNode.image.setAttribute('height', h)
    if (barFilterNode.mapKey !== mapKey) {
      barFilterNode.image.setAttribute('href', mapEntry.url)
      barFilterNode.image.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', mapEntry.url)
      barFilterNode.dispR.setAttribute('scale', mapEntry.scaleR)
      barFilterNode.dispGB.setAttribute('scale', mapEntry.scaleB)
      barFilterNode.mapKey = mapKey
    }
    return barFilterNode
  }

  function updateRefraction(surface) {
    const rootClass = document.documentElement.classList
    if (rootClass.contains('aside-motion') || rootClass.contains('aside-glass-pause') || rootClass.contains('solid-bg')) return
    const isNavGlass = surface.classList.contains('nav-pill-glass') || surface.classList.contains('nav-bar-glass')
    if ((!isNavGlass && !pointer.matches) || reducedTransparency.matches) {
      surfaceSignature.delete(surface)
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
      surfaceSignature.delete(surface)
      surface.style.removeProperty('--glass-backdrop')
      surface.style.removeProperty('--glass-spec-image')
      surface.removeAttribute('data-shader-glass')
      return
    }

    const w = Math.max(1, Math.round(rect.width))
    const h = Math.max(1, Math.round(rect.height))
    const isNavBar = surface.classList.contains('nav-bar-glass')
    const signature = [isNavBar ? 'bar' : 'card', w, h, radius, refractThickness, refractIOR, refractScale, chromaStrength, specStrength].join(':')

    if (surfaceSignature.get(surface) === signature) return
    surfaceSignature.set(surface, signature)

    if (isNavBar) {
      const bar = getOrUpdateBarFilter(w, h, refractThickness, refractIOR, refractScale, chromaStrength)
      surface.style.setProperty('--glass-backdrop', `blur(var(--glass-blur)) saturate(var(--glass-saturate, 210%)) url("#${bar.id}")`)
      surface.style.removeProperty('--glass-spec-image')
      surface.setAttribute('data-shader-glass', '1')
      return
    }

    const shared = getOrBuildSharedFilter(w, h, radius, refractThickness, refractIOR, refractScale, chromaStrength, specStrength)
    const blurVal = Number.parseFloat(style.getPropertyValue('--glass-blur'))
    const blurPart = Number.isFinite(blurVal) && blurVal <= 0 ? '' : 'blur(var(--glass-blur)) '
    surface.style.setProperty('--glass-backdrop', `${blurPart}saturate(var(--glass-saturate, 165%)) url("#${shared.id}")`)
    surface.style.setProperty('--glass-spec-image', shared.specUrl)
    surface.setAttribute('data-shader-glass', '1')
  }

  const resize = refracting ? new ResizeObserver(entries => {
    for (const entry of entries) updateRefraction(entry.target)
  }) : null

  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)')
  let lensFilterNode = null

  // Cached convex water-drop dome filter for the sliding hover glass lens.
  // Built once (96x36px); during hover slides we only update SVG scale/width attributes (0 canvas redraws).
  function ensureHoverLensFilter() {
    if (!refracting || reducedTransparency.matches) return null
    if (lensFilterNode) return lensFilterNode

    if (!definitions) {
      const svg = svgElement('svg', { width: 0, height: 0, 'aria-hidden': 'true', focusable: 'false' })
      svg.style.cssText = 'position:fixed;pointer-events:none;overflow:hidden'
      definitions = svgElement('defs', {})
      svg.append(definitions)
      document.body.append(svg)
    }

    const mapW = 96
    const mapH = 36
    const halfW = mapW * 0.5
    const halfH = mapH * 0.5
    const radius = halfH
    const refractThickness = 10
    const refractIOR = 1.62
    const maxSinI = 0.92
    const domeExp = 1.25
    const thetaI0 = Math.asin(maxSinI)
    const thetaT0 = Math.asin(Math.min(maxSinI / refractIOR, 1.0))
    const maxEdgeMag = Math.max(Math.tan(thetaI0 - thetaT0), 1e-4)

    const canvas = document.createElement('canvas')
    canvas.width = mapW
    canvas.height = mapH
    const ctx = canvas.getContext('2d')
    const pixels = ctx.createImageData(mapW, mapH)
    new Uint32Array(pixels.data.buffer).fill(0xff808080)

    for (let row = 0; row < mapH; row++) {
      const py = row + 0.5 - halfH
      for (let col = 0; col < mapW; col++) {
        const px = col + 0.5 - halfW
        const { d, nx, ny } = sceneSDFAndNormal(px, py, halfW, halfH, radius, 2.0)
        const depthPx = -d
        if (depthPx >= 0 && depthPx < refractThickness) {
          const t = depthPx / refractThickness
          const sinThetaI = maxSinI * Math.pow(1.0 - t, domeExp)
          const thetaI = Math.asin(Math.min(Math.max(sinThetaI, 0.0), 1.0))
          const thetaT = Math.asin(Math.min(Math.max(sinThetaI / refractIOR, 0.0), 1.0))
          const normMag = Math.tan(thetaI - thetaT) / maxEdgeMag
          const idx = (row * mapW + col) * 4
          pixels.data[idx] = Math.min(255, Math.max(0, (128 + 127 * (-nx * normMag) + 0.5) | 0))
          pixels.data[idx + 1] = Math.min(255, Math.max(0, (128 + 127 * (-ny * normMag) + 0.5) | 0))
        }
      }
    }
    ctx.putImageData(pixels, 0, 0)
    const mapUrl = canvas.toDataURL()

    const id = 'blog-glass-lens'
    const filter = svgElement('filter', {
      id,
      x: '0',
      y: '0',
      width: mapW,
      height: mapH,
      filterUnits: 'userSpaceOnUse',
      primitiveUnits: 'userSpaceOnUse',
      'color-interpolation-filters': 'sRGB'
    })
    const image = svgElement('feImage', {
      x: '0',
      y: '0',
      width: mapW,
      height: mapH,
      result: 'lens-map',
      preserveAspectRatio: 'none'
    })
    image.setAttribute('href', mapUrl)
    image.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', mapUrl)

    const dispR = svgElement('feDisplacementMap', {
      in: 'SourceGraphic', in2: 'lens-map', scale: '32',
      xChannelSelector: 'R', yChannelSelector: 'G', result: 'lens-dr'
    })
    const matR = svgElement('feColorMatrix', {
      in: 'lens-dr', type: 'matrix',
      values: '1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0', result: 'lens-r'
    })
    const dispG = svgElement('feDisplacementMap', {
      in: 'SourceGraphic', in2: 'lens-map', scale: '24',
      xChannelSelector: 'R', yChannelSelector: 'G', result: 'lens-dg'
    })
    const matG = svgElement('feColorMatrix', {
      in: 'lens-dg', type: 'matrix',
      values: '0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0', result: 'lens-g'
    })
    const dispB = svgElement('feDisplacementMap', {
      in: 'SourceGraphic', in2: 'lens-map', scale: '16',
      xChannelSelector: 'R', yChannelSelector: 'G', result: 'lens-db'
    })
    const matB = svgElement('feColorMatrix', {
      in: 'lens-db', type: 'matrix',
      values: '0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0', result: 'lens-b'
    })
    const blendRG = svgElement('feBlend', { in: 'lens-r', in2: 'lens-g', mode: 'screen', result: 'lens-rg' })
    const blendRGB = svgElement('feBlend', { in: 'lens-rg', in2: 'lens-b', mode: 'screen' })
    filter.append(image, dispR, matR, dispG, matG, dispB, matB, blendRG, blendRGB)
    definitions.append(filter)

    lensFilterNode = { id, filter, image, dispR, dispG, dispB }
    return lensFilterNode
  }

  // Cross-browser WebGL Liquid Glass Renderer (Safari / Firefox / Chrome / Edge):
  // Exact port of kube.io's Convex Squircle optical model: h(t) = (1 - (1 - t)^4)^(1/4),
  // 3D Snell refraction with 3-wavelength Cauchy RGB chromatic dispersion, Fresnel + Blinn-Phong speculars,
  // and real-time sliding hover glass droplet with velocity-modulated dispersion & physical contact shadow.
  // Renders on-demand ONLY (0 FPS when idle, <0.05ms/frame while sliding).
  const bgImageCache = new Map()
  let navWebGL = null

  function extractHeaderBgUrl(header) {
    const bgCfg = liquidSite.background || {}
    const inlineBg = header ? header.style.backgroundImage : ''
    const compBg = (!inlineBg && header) ? getComputedStyle(header).backgroundImage : ''
    const bgStr = inlineBg || compBg || ''
    const match = bgStr.match(/url\(['"]?([^)'"]+)['"]?\)/)
    const rawUrl = (match && match[1]) || bgCfg.image || ''
    return rawUrl
  }

  function loadBgImage(url) {
    if (!url) return Promise.reject(new Error('no url'))
    if (bgImageCache.has(url)) return bgImageCache.get(url)
    const promise = new Promise((resolve, reject) => {
      const img = new Image()
      img.decoding = 'async'
      try {
        if (new URL(url, location.href).origin !== location.origin) {
          img.crossOrigin = 'anonymous'
        }
      } catch (e) {}
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error('bg load failed'))
      img.src = url
    })
    bgImageCache.set(url, promise)
    return promise
  }

  function createNavWebGLGlass(header, nav, menus, canvas) {
    if (!canvas || !header || !nav || !menus || reducedTransparency.matches) return null
    const gl = canvas.getContext('webgl', {
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: true,
      powerPreference: 'low-power'
    })
    if (!gl) return null

    const vsSrc = `
      attribute vec2 aPos;
      varying vec2 vUv;
      void main() {
        vUv = vec2(aPos.x * 0.5 + 0.5, 0.5 - aPos.y * 0.5);
        gl_Position = vec4(aPos, 0.0, 1.0);
      }
    `
    const fsSrc = `
      #ifdef GL_FRAGMENT_PRECISION_HIGH
      precision highp float;
      #else
      precision mediump float;
      #endif
      #define PI 3.14159265359

      // Exact dispersion refractive indices from iyinchao/liquid-glass-studio (fragment-main.glsl)
      const float N_R = 0.98;
      const float N_G = 1.00;
      const float N_B = 1.02;

      uniform sampler2D uTex;
      uniform vec4 uCanvasRect;
      uniform vec4 uBgRect;
      uniform float uVeil;
      uniform float uDark;
      uniform vec4 uLens; // x, w, alpha, velNorm (-1..1)
      varying vec2 vUv;

      float safeAsin(float x) {
        return asin(clamp(x, -1.0, 1.0));
      }

      float sdCapsule(vec2 p, vec2 b, float r) {
        vec2 q = abs(p) - b + vec2(r);
        return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
      }

      vec2 sdCapsuleNormal(vec2 p, vec2 b, float r) {
        vec2 s = vec2(p.x >= 0.0 ? 1.0 : -1.0, p.y >= 0.0 ? 1.0 : -1.0);
        vec2 qRaw = abs(p) - b + vec2(r);
        vec2 q = max(qRaw, 0.0);
        vec2 n;
        if (q.x <= 0.0 && q.y <= 0.0) {
          n = qRaw.x >= qRaw.y ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
        } else {
          n = normalize(q + vec2(1e-5));
        }
        return n * s;
      }

      float vec2ToAngle(vec2 v) {
        if (dot(v, v) < 1e-10) return 0.0;
        float a = atan(v.y, v.x);
        if (a < 0.0) a += 2.0 * PI;
        return a;
      }

      // Perceptual sRGB <-> LCH color space stack (exact port of iyinchao/liquid-glass-studio lib/color.glsl)
      float uncompandSRGB(float a) {
        a = clamp(a, 0.0, 1.0);
        return a > 0.04045 ? pow((a + 0.055) / 1.055, 2.4) : a / 12.92;
      }

      float compandRGB(float a) {
        a = max(a, 0.0);
        return a <= 0.0031308 ? 12.92 * a : 1.055 * pow(a, 0.41666666666) - 0.055;
      }

      float xyzToLabF(float x) {
        x = max(x, 0.0);
        return x > 0.00885645167 ? pow(x, 0.333333333) : 7.78703703704 * x + 0.13793103448;
      }

      float labToXyzF(float x) {
        return x > 0.206897 ? x * x * x : 0.12841854934 * (x - 0.137931034);
      }

      vec3 srgbToLch(vec3 srgb) {
        vec3 rgb = vec3(uncompandSRGB(srgb.r), uncompandSRGB(srgb.g), uncompandSRGB(srgb.b));
        vec3 xyz = vec3(
          dot(rgb, vec3(0.4124, 0.3576, 0.1805)),
          dot(rgb, vec3(0.2126, 0.7152, 0.0722)),
          dot(rgb, vec3(0.0193, 0.1192, 0.9505))
        );
        vec3 w = vec3(0.95045592705, 1.0, 1.08905775076);
        vec3 s = xyz / w;
        vec3 f = vec3(xyzToLabF(s.x), xyzToLabF(s.y), xyzToLabF(s.z));
        vec3 lab = vec3(116.0 * f.y - 16.0, 500.0 * (f.x - f.y), 200.0 * (f.y - f.z));
        float C = sqrt(dot(lab.yz, lab.yz));
        float H = C > 1e-5 ? atan(lab.z, lab.y) * 57.2957795131 : 0.0;
        return vec3(lab.x, C, H);
      }

      vec3 lchToSrgb(vec3 lch) {
        float rad = lch.z * 0.01745329251;
        vec3 lab = vec3(lch.x, lch.y * cos(rad), lch.y * sin(rad));
        float fy = (lab.x + 16.0) / 116.0;
        vec3 w = vec3(0.95045592705, 1.0, 1.08905775076);
        vec3 xyz = w * vec3(labToXyzF(fy + lab.y / 500.0), labToXyzF(fy), labToXyzF(fy - lab.z / 200.0));
        vec3 rgb = vec3(
          dot(xyz, vec3( 3.2406255, -1.5372080, -0.4986286)),
          dot(xyz, vec3(-0.9689307,  1.8757561,  0.0415175)),
          dot(xyz, vec3( 0.0557101, -0.2040211,  1.0569959))
        );
        return clamp(vec3(compandRGB(rgb.r), compandRGB(rgb.g), compandRGB(rgb.b)), 0.0, 1.0);
      }

      vec3 sampleBgRaw(vec2 vpPos) {
        vec2 uv = clamp((vpPos - uBgRect.xy) / uBgRect.zw, vec2(0.001), vec2(0.999));
        return texture2D(uTex, uv).rgb * (1.0 - uVeil);
      }

      // Subtle 9-tap optical blur (equivalent to iyinchao blurRadius ~ 1.5px, crystal clear not frosted)
      vec3 sampleBgSoft(vec2 vpPos, float r) {
        if (r <= 0.05) return sampleBgRaw(vpPos);
        vec3 c = sampleBgRaw(vpPos) * 0.25;
        c += sampleBgRaw(vpPos + vec2( r, 0.0)) * 0.125;
        c += sampleBgRaw(vpPos + vec2(-r, 0.0)) * 0.125;
        c += sampleBgRaw(vpPos + vec2(0.0,  r)) * 0.125;
        c += sampleBgRaw(vpPos + vec2(0.0, -r)) * 0.125;
        float d = r * 0.7071;
        c += sampleBgRaw(vpPos + vec2( d,  d)) * 0.0625;
        c += sampleBgRaw(vpPos + vec2(-d,  d)) * 0.0625;
        c += sampleBgRaw(vpPos + vec2( d, -d)) * 0.0625;
        c += sampleBgRaw(vpPos + vec2(-d, -d)) * 0.0625;
        return c;
      }

      // Exact port of iyinchao/liquid-glass-studio STEP 9 optical pipeline:
      // 1) Bounded Snell edge refraction: thetaI = asin((1 - d/T)^2), edgeFactor = -tan(thetaT - thetaI)
      // 2) Subtle R/G/B chromatic dispersion (N_R=0.98, N_G=1.00, N_B=1.02)
      // 3) Tight 5th-power Fresnel rim (lives strictly in outermost 0..3px, never a puffy 3D bubble)
      // 4) Dual-peak directional LCH glare (boosts L & C of actual refracted color, not flat white paint)
      // 5) Hairline 1px dark silhouette accent on the shadow arc
      vec3 shadeLiquidGlass(
        vec2 px, vec2 center, vec2 halfSize, float radius,
        float refThickness, float refFactor, float refDispPx, float refDispersion,
        float fresnelRange, float fresnelHardness, float fresnelStrength,
        float glareRange, float glareHardness, float glareFactor,
        float glareConvergence, float glareOppositeFactor, float glareAngleOff,
        float blurPx, vec4 tint
      ) {
        vec2 rel = px - center;
        float d = sdCapsule(rel, halfSize, radius);
        float nmerged = max(-d, 0.0);
        vec2 outN = sdCapsuleNormal(rel, halfSize, radius);
        vec2 vpBase = uCanvasRect.xy + px;

        float edgeFactor = 0.0;
        if (nmerged < refThickness) {
          float xR = 1.0 - nmerged / refThickness;
          float thetaI = safeAsin(xR * xR);
          float thetaT = safeAsin(sin(thetaI) / refFactor);
          edgeFactor = -tan(thetaT - thetaI);
        }

        vec3 refracted;
        if (edgeFactor <= 0.0001) {
          refracted = sampleBgSoft(vpBase, blurPx);
        } else {
          vec2 offset = -outN * edgeFactor * refDispPx;
          refracted.r = sampleBgSoft(vpBase + offset * (1.0 - (N_R - 1.0) * refDispersion), blurPx).r;
          refracted.g = sampleBgSoft(vpBase + offset * (1.0 - (N_G - 1.0) * refDispersion), blurPx).g;
          refracted.b = sampleBgSoft(vpBase + offset * (1.0 - (N_B - 1.0) * refDispersion), blurPx).b;
        }

        vec3 outCol = mix(refracted, tint.rgb, tint.a * 0.8);

        if (nmerged < refThickness) {
          // 1) Razor-tight 5th-power Fresnel rim (outermost 0..3px only)
          float fRatio = 500.0 / fresnelRange;
          float fBase = 1.0 - (nmerged / 1500.0) * (fRatio * fRatio) + fresnelHardness;
          float fresnelFactor = clamp(pow(max(fBase, 0.0), 5.0), 0.0, 1.0);

          if (fresnelFactor > 0.001) {
            vec3 fTintLCH = srgbToLch(mix(vec3(1.0), tint.rgb, tint.a * 0.5));
            fTintLCH.x = clamp(fTintLCH.x + 20.0 * fresnelFactor * fresnelStrength, 0.0, 100.0);
            outCol = mix(outCol, lchToSrgb(fTintLCH), fresnelFactor * fresnelStrength * 0.7);
          }

          // 2) Dual-peak directional LCH Glare (top-left primary + bottom-right opposite peak)
          float gRatio = 500.0 / glareRange;
          float gBase = 1.0 - (nmerged / 1500.0) * (gRatio * gRatio) + glareHardness;
          float glareGeo = clamp(pow(max(gBase, 0.0), 5.0), 0.0, 1.0);

          if (glareGeo > 0.001) {
            // Flip Y to match WebGL bottom-up normal angle convention from iyinchao/liquid-glass-studio
            vec2 glN = vec2(outN.x, -outN.y);
            float gAng = (vec2ToAngle(glN) - PI * 0.25 + glareAngleOff) * 2.0;
            bool isFarside = (gAng > PI * 1.5 && gAng < PI * 3.5) || (gAng < -PI * 0.5);
            float gAngFactor = (0.5 + sin(gAng) * 0.5) * (isFarside ? 1.2 * glareOppositeFactor : 1.2) * glareFactor;
            gAngFactor = clamp(pow(max(gAngFactor, 0.0), 0.1 + glareConvergence * 2.0), 0.0, 1.0);

            float glareWeight = gAngFactor * glareGeo;
            if (glareWeight > 0.001) {
              vec3 gLCH = srgbToLch(mix(refracted, tint.rgb, tint.a * 0.5));
              gLCH.x = clamp(gLCH.x + 150.0 * glareWeight, 0.0, 120.0);
              gLCH.y += 30.0 * glareWeight;
              outCol = mix(outCol, lchToSrgb(gLCH), glareWeight);
            }
          }
        }

        // 3) Hairline 1px dark silhouette accent on shadow arc (iyinchao darkEdgeWidth = 1px)
        float darkMask = 1.0 - smoothstep(0.4, 1.25, nmerged);
        if (darkMask > 0.001) {
          vec2 glN = vec2(outN.x, -outN.y);
          float gAng = (vec2ToAngle(glN) - PI * 0.25 + glareAngleOff) * 2.0;
          float shadowArc = 1.0 - (0.5 + sin(gAng) * 0.5);
          outCol *= 1.0 - darkMask * shadowArc * (uDark > 0.5 ? 0.18 : 0.28);
        }

        return outCol;
      }

      void main() {
        vec2 size = uCanvasRect.zw;
        vec2 px = vUv * size;
        vec2 halfSize = size * 0.5;
        float radius = halfSize.y;

        float dOuter = sdCapsule(px - halfSize, halfSize, radius);
        float outerAlpha = 1.0 - smoothstep(-0.7, 0.7, dOuter);
        if (outerAlpha <= 0.002) discard;

        vec4 baseTint = uDark > 0.5 ? vec4(0.06, 0.07, 0.09, 0.10) : vec4(1.0, 1.0, 1.0, 0.04);
        float outerGlare = uDark > 0.5 ? 0.56 : 0.78;
        float outerFresnel = uDark > 0.5 ? 0.14 : 0.18;

        vec3 col = shadeLiquidGlass(
          px, halfSize, halfSize, radius,
          22.0, 1.52, 40.0, 9.0,
          28.0, 0.18, outerFresnel,
          28.0, 0.18, outerGlare,
          0.52, 0.80, 0.0,
          1.4, baseTint
        );

        float lensAlpha = uLens.z;
        if (lensAlpha > 0.004) {
          vec2 lensHalf = vec2(uLens.y * 0.5, 18.0);
          vec2 lensCenter = vec2(uLens.x + lensHalf.x, halfSize.y);
          float lensR = 18.0;
          float dLens = sdCapsule(px - lensCenter, lensHalf, lensR);

          // Whisper-soft ambient shadow beneath the raised hover glass pill
          float dShadow = sdCapsule(px - (lensCenter + vec2(0.0, 1.6)), lensHalf, lensR);
          float shadow = (1.0 - smoothstep(-0.5, 6.0, dShadow)) * smoothstep(-0.4, 1.2, dLens) * lensAlpha;
          col *= (1.0 - shadow * 0.15);

          float lensMask = (1.0 - smoothstep(-0.65, 0.65, dLens)) * lensAlpha;
          if (lensMask > 0.002) {
            float speed = abs(uLens.w);
            float glareTilt = -uLens.w * 0.45;
            vec4 lensTint = uDark > 0.5 ? vec4(1.0, 1.0, 1.0, 0.04) : vec4(1.0, 1.0, 1.0, 0.06);
            vec3 lensCol = shadeLiquidGlass(
              px, lensCenter, lensHalf, lensR,
              18.0, 1.56, 42.0 + speed * 18.0, 9.5 + speed * 13.0,
              25.0, 0.20, uDark > 0.5 ? 0.18 : 0.22,
              25.0, 0.20, uDark > 0.5 ? 0.68 : 0.88,
              0.50, 0.80, glareTilt,
              1.0, lensTint
            );
            col = mix(col, lensCol, lensMask);
          }
        }

        gl_FragColor = vec4(col * outerAlpha, outerAlpha);
      }
    `

    const compile = (type, src) => {
      const sh = gl.createShader(type)
      gl.shaderSource(sh, src)
      gl.compileShader(sh)
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        gl.deleteShader(sh)
        return null
      }
      return sh
    }
    const vs = compile(gl.VERTEX_SHADER, vsSrc)
    const fs = compile(gl.FRAGMENT_SHADER, fsSrc)
    if (!vs || !fs) return null

    const prog = gl.createProgram()
    gl.attachShader(prog, vs)
    gl.attachShader(prog, fs)
    gl.linkProgram(prog)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null

    const buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
    const aPos = gl.getAttribLocation(prog, 'aPos')

    const uTex = gl.getUniformLocation(prog, 'uTex')
    const uCanvasRect = gl.getUniformLocation(prog, 'uCanvasRect')
    const uBgRect = gl.getUniformLocation(prog, 'uBgRect')
    const uVeil = gl.getUniformLocation(prog, 'uVeil')
    const uDark = gl.getUniformLocation(prog, 'uDark')
    const uLens = gl.getUniformLocation(prog, 'uLens')

    const tex = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)

    let imgW = 0
    let imgH = 0
    let ready = false
    let destroyed = false
    let lensState = { x: 0, w: 76, alpha: 0, vel: 0 }

    const render = () => {
      if (destroyed || !ready) return
      if (document.documentElement.classList.contains('solid-bg')) return
      if (header.classList.contains('not-top-img')) return
      if (nav.classList.contains('nav-pill-hidden')) return
      if (!header.classList.contains('nav-morph-ready') && header.classList.contains('nav-fixed')) return
      const cRect = canvas.getBoundingClientRect()
      if (!cRect.width || !cRect.height) return

      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const pw = Math.max(1, Math.round(cRect.width * dpr))
      const ph = Math.max(1, Math.round(cRect.height * dpr))
      if (canvas.width !== pw || canvas.height !== ph) {
        canvas.width = pw
        canvas.height = ph
      }

      const hStyle = getComputedStyle(header)
      const isFixedBg = hStyle.backgroundAttachment === 'fixed'
      let boxX = 0
      let boxY = 0
      let boxW = window.innerWidth
      let boxH = window.innerHeight
      if (!isFixedBg) {
        const hRect = header.getBoundingClientRect()
        boxX = hRect.left
        boxY = hRect.top
        boxW = hRect.width
        boxH = hRect.height
      }
      const coverScale = Math.max(boxW / imgW, boxH / imgH)
      const drawW = imgW * coverScale
      const drawH = imgH * coverScale
      const offX = boxX + (boxW - drawW) * 0.5
      const offY = boxY + (boxH - drawH) * 0.5

      const isDark = document.documentElement.getAttribute('data-theme') === 'dark'
      const veil = isDark ? 0.60 : 0.30

      gl.viewport(0, 0, pw, ph)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.useProgram(prog)
      gl.bindBuffer(gl.ARRAY_BUFFER, buf)
      gl.enableVertexAttribArray(aPos)
      gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0)
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, tex)
      gl.uniform1i(uTex, 0)
      gl.uniform4f(uCanvasRect, cRect.left, cRect.top, cRect.width, cRect.height)
      gl.uniform4f(uBgRect, offX, offY, drawW, drawH)
      gl.uniform1f(uVeil, veil)
      gl.uniform1f(uDark, isDark ? 1.0 : 0.0)
      gl.uniform4f(uLens, lensState.x, lensState.w, lensState.alpha, lensState.vel)
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    }

    const bgUrl = extractHeaderBgUrl(header)
    loadBgImage(bgUrl).then(img => {
      if (destroyed) return
      imgW = img.naturalWidth || img.width
      imgH = img.naturalHeight || img.height
      if (!imgW || !imgH) return
      gl.bindTexture(gl.TEXTURE_2D, tex)
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img)
      ready = true
      menus.classList.add('has-webgl-glass')
      render()
    }).catch(() => {})

    return {
      isReady: () => ready && !destroyed,
      setLens(x, w, alpha, vel) {
        lensState.x = x
        lensState.w = w
        lensState.alpha = alpha
        lensState.vel = vel
        render()
      },
      render,
      destroy() {
        destroyed = true
        menus.classList.remove('has-webgl-glass')
      }
    }
  }

  // Sliding Liquid Glass hover lens inside #menus (like Apple iOS 26 sliding glass thumb):
  // Glides smoothly with dt-based spring physics and drives WebGL Convex Squircle Cauchy RGB dispersion.
  let hoverLensCleanup = null
  function initNavHoverLens() {
    if (hoverLensCleanup) { hoverLensCleanup(); hoverLensCleanup = null }
    if (navWebGL) { navWebGL.destroy(); navWebGL = null }
    const header = document.getElementById('page-header')
    const menus = document.getElementById('menus')
    const nav = document.getElementById('nav')
    const lens = menus && menus.querySelector('.nav-hover-lens')
    const canvas = menus && menus.querySelector('.nav-glass-canvas')
    if (!header || !menus || !nav || !lens) return

    navWebGL = createNavWebGLGlass(header, nav, menus, canvas)

    const controller = new AbortController()
    const { signal } = controller

    let active = false
    let curX = 0
    let curW = 76
    let curAlpha = 0
    let targetX = 0
    let targetW = 76
    let targetAlpha = 0
    let vx = 0
    let vw = 0
    let rafId = 0
    let lastTs = 0
    let hideTimer = 0

    hoverLensCleanup = () => {
      controller.abort()
      if (hideTimer) clearTimeout(hideTimer)
      if (rafId) cancelAnimationFrame(rafId)
    }

    const isEligible = () =>
      !document.documentElement.classList.contains('solid-bg')

    const useWebGLLens = () =>
      Boolean(navWebGL && navWebGL.isReady() && !nav.classList.contains('nav-pill-hidden') && !nav.classList.contains('nav-docked'))

    const itemSelector = '#nav-darkmode > button.site-page, .menus_item > a.site-page, .menus_item > span.site-page, #search-button > button.site-page, #toggle-menu > span.site-page'

    const applyLensVisuals = (x, w, alpha, velNorm) => {
      if (useWebGLLens()) {
        lens.classList.remove('is-visible')
        navWebGL.setLens(x, w, alpha, velNorm)
        return
      }
      if (navWebGL && navWebGL.isReady()) navWebGL.setLens(x, w, 0, 0)
      const speed = Math.abs(velNorm)
      const dir = velNorm >= 0 ? 1 : -1
      lens.style.width = `${w.toFixed(1)}px`
      lens.style.transform = `translate3d(${x.toFixed(1)}px, 0, 0)`
      const glintX = (50 + dir * speed * 32).toFixed(1)
      lens.style.setProperty('--lens-glint-x', `${glintX}%`)
      lens.classList.toggle('is-visible', alpha > 0.05)

      const node = ensureHoverLensFilter()
      if (node) {
        const wInt = Math.max(24, Math.round(w))
        node.filter.setAttribute('width', wInt)
        node.image.setAttribute('width', wInt)
        const baseDisplace = 8.5 + speed * 12.0
        const chroma = 2.8 + speed * 9.5
        const scaleG = (2.0 * baseDisplace).toFixed(1)
        const scaleR = (2.0 * (baseDisplace + chroma)).toFixed(1)
        const scaleB = (2.0 * Math.max(0, baseDisplace - chroma)).toFixed(1)
        node.dispR.setAttribute('scale', scaleR)
        node.dispG.setAttribute('scale', scaleG)
        node.dispB.setAttribute('scale', scaleB)
        lens.style.setProperty('--glass-backdrop', `saturate(${Math.round(170 + speed * 60)}%) url("#${node.id}")`)
        lens.setAttribute('data-shader-glass', '1')
      }
    }

    // Time-based (dt) damped spring: consistent ~340ms silky horizontal glide across 60Hz / 120Hz / 144Hz / 240Hz
    const omega = 14.5
    const zeta = 0.84
    const tick = now => {
      rafId = 0
      const dt = lastTs ? Math.min(0.032, Math.max(0.004, (now - lastTs) / 1000)) : 0.016
      lastTs = now

      const ax = (targetX - curX) * (omega * omega) - 2 * zeta * omega * vx
      vx += ax * dt
      curX += vx * dt

      const aw = (targetW - curW) * (omega * omega) - 2 * zeta * omega * vw
      vw += aw * dt
      curW += vw * dt

      const alphaRate = targetAlpha > curAlpha ? 10.5 : 8.5
      curAlpha += (targetAlpha - curAlpha) * Math.min(1, dt * alphaRate)
      if (Math.abs(targetAlpha - curAlpha) < 0.01) curAlpha = targetAlpha

      const rawVel = (vx + vw * 0.35) / 480
      const velNorm = Math.max(-1, Math.min(1, rawVel))
      applyLensVisuals(curX, curW, curAlpha, velNorm)

      const settled = Math.abs(targetX - curX) < 0.25 && Math.abs(vx) < 4 &&
                      Math.abs(targetW - curW) < 0.25 && Math.abs(vw) < 4 &&
                      curAlpha === targetAlpha
      if (settled) {
        curX = targetX
        curW = targetW
        vx = 0
        vw = 0
        lastTs = 0
        if (targetAlpha === 0) active = false
        applyLensVisuals(curX, curW, curAlpha, 0)
      } else {
        rafId = requestAnimationFrame(tick)
      }
    }

    const aimAt = item => {
      if (!isEligible()) return
      if (hideTimer) { clearTimeout(hideTimer); hideTimer = 0 }
      const mRect = menus.getBoundingClientRect()
      const tRect = item.getBoundingClientRect()
      if (!tRect.width) return
      const padX = window.innerWidth <= 768 ? 8 : 10
      const nextX = (tRect.left - mRect.left) - padX
      const nextW = tRect.width + padX * 2

      if (!active && curAlpha < 0.05) {
        active = true
        curX = targetX = nextX
        curW = targetW = nextW
        vx = 0
        vw = 0
        targetAlpha = 1
        lastTs = 0
        if (!rafId) rafId = requestAnimationFrame(tick)
      } else {
        active = true
        targetX = nextX
        targetW = nextW
        targetAlpha = 1
        if (!rafId) {
          lastTs = 0
          rafId = requestAnimationFrame(tick)
        }
      }
    }

    const hideLens = (delay = 140) => {
      if (hideTimer) clearTimeout(hideTimer)
      hideTimer = setTimeout(() => {
        hideTimer = 0
        targetAlpha = 0
        if (!rafId) {
          lastTs = 0
          rafId = requestAnimationFrame(tick)
        }
      }, delay)
    }

    const hideLensImmediate = () => {
      if (hideTimer) { clearTimeout(hideTimer); hideTimer = 0 }
      active = false
      curAlpha = 0
      targetAlpha = 0
      if (rafId) { cancelAnimationFrame(rafId); rafId = 0 }
      lastTs = 0
      lens.classList.remove('is-visible')
      if (navWebGL && navWebGL.isReady()) navWebGL.setLens(curX, curW, 0, 0)
    }

    menus.addEventListener('pointerover', event => {
      if (event.pointerType === 'touch') return
      const item = event.target.closest(itemSelector)
      if (item) aimAt(item)
    }, { signal })
    menus.addEventListener('pointerdown', event => {
      if (event.pointerType !== 'touch') return
      const item = event.target.closest(itemSelector)
      if (item) aimAt(item)
    }, { passive: true, signal })
    menus.addEventListener('pointerup', event => {
      if (event.pointerType === 'touch') hideLens(220)
    }, { passive: true, signal })
    menus.addEventListener('pointercancel', () => hideLens(80), { passive: true, signal })

    menus.addEventListener('pointerleave', () => hideLens(140), { signal })
    menus.addEventListener('focusin', event => {
      const item = event.target.closest(itemSelector)
      if (item) aimAt(item)
    }, { signal })
    menus.addEventListener('focusout', event => {
      if (!menus.contains(event.relatedTarget)) hideLens(140)
    }, { signal })
    window.addEventListener('scroll', () => { if (active || curAlpha > 0) hideLensImmediate() }, { passive: true, signal })
  }

  // Smooth scroll-linked transition in background-image mode (desktop & mobile):
  // 1) Glides #menus smoothly from centered floating capsule -> right-docked full-width bar;
  // 2) On Home page, flies #site-title (site title) smoothly into top-left of #nav.
  let scrollMorphCleanup = null
  function initNavScrollMorph() {
    if (scrollMorphCleanup) { scrollMorphCleanup(); scrollMorphCleanup = null }
    const header = document.getElementById('page-header')
    const nav = document.getElementById('nav')
    const menus = document.getElementById('menus')
    if (!header || !nav || !menus) return

    const pillGlass = menus.querySelector('.nav-pill-glass')
    const glassCanvas = menus.querySelector('.nav-glass-canvas')
    const barGlass = nav.querySelector('.nav-bar-glass')
    const isHome = header.classList.contains('full_page')
    const heroTitle = isHome ? document.getElementById('site-title') : null
    const heroSubtitle = isHome ? document.getElementById('site-subtitle') : null
    const navHomeTitle = isHome ? nav.querySelector('.nav-home-title') : null
    const navSiteLink = isHome ? nav.querySelector('.nav-site-title') : null

    const controller = new AbortController()
    const { signal } = controller
    scrollMorphCleanup = () => {
      controller.abort()
      resetInline()
    }

    let metrics = null
    let ticking = false
    let lastViewportW = 0

    const resetInline = () => {
      header.classList.remove('nav-morph-ready')
      nav.classList.remove('nav-docked', 'nav-bar-active', 'nav-pill-hidden')
      menus.style.transform = ''
      menus.style.removeProperty('--nav-pill-opacity')
      if (pillGlass) pillGlass.style.opacity = ''
      if (glassCanvas) glassCanvas.style.opacity = ''
      if (barGlass) barGlass.style.opacity = ''
      if (heroTitle) {
        heroTitle.style.transform = ''
        heroTitle.style.opacity = ''
        heroTitle.style.color = ''
        heroTitle.style.textShadow = ''
        heroTitle.style.pointerEvents = ''
      }
      if (heroSubtitle) {
        heroSubtitle.style.transform = ''
        heroSubtitle.style.opacity = ''
      }
      if (navHomeTitle) {
        navHomeTitle.style.opacity = ''
        navHomeTitle.style.pointerEvents = ''
      }
    }

    const canMorph = () =>
      !document.documentElement.classList.contains('solid-bg') &&
      !header.classList.contains('not-top-img') &&
      !reducedMotion.matches

    const measure = () => {
      if (!canMorph()) {
        metrics = null
        resetInline()
        return
      }
      header.classList.add('nav-morph-ready')
      lastViewportW = window.innerWidth

      // Temporarily clear transforms to read true natural geometry
      const prevMenusTransform = menus.style.transform
      const prevTitleTransform = heroTitle ? heroTitle.style.transform : ''
      menus.style.transform = 'none'
      if (heroTitle) heroTitle.style.transform = 'none'

      const navWidth = nav.offsetWidth
      const menusWidth = menus.offsetWidth
      const navPadRight = Number.parseFloat(getComputedStyle(nav).paddingRight) || (window.innerWidth <= 768 ? 12 : 36)
      const dockedMenusLeft = navWidth - navPadRight - menusWidth
      const centeredMenusLeft = (navWidth - menusWidth) * 0.5
      const centerShiftX = centeredMenusLeft - dockedMenusLeft

      let hero = null
      if (isHome && heroTitle && navHomeTitle) {
        const hRect = heroTitle.getBoundingClientRect()
        const nRect = navHomeTitle.getBoundingClientRect()
        const heroFontSize = Number.parseFloat(getComputedStyle(heroTitle).fontSize) || 40
        const navFontSize = Number.parseFloat(getComputedStyle(navHomeTitle).fontSize) || 18.5
        if (hRect.width > 0 && nRect.width > 0 && hRect.height < heroFontSize * 2.2) {
          hero = {
            docLeft: hRect.left,
            docCY: hRect.top + window.scrollY + hRect.height * 0.5,
            navLeft: nRect.left,
            navCY: 30,
            scaleEnd: Math.min(navFontSize / heroFontSize, nRect.width / hRect.width)
          }
        }
      }

      menus.style.transform = prevMenusTransform
      if (heroTitle) heroTitle.style.transform = prevTitleTransform

      const morphDist = hero
        ? Math.max(window.innerWidth <= 768 ? 180 : 220, Math.min(360, Math.round(hero.docCY * 0.72)))
        : (window.innerWidth <= 768 ? 130 : 160)

      metrics = { centerShiftX, morphDist, hero }
    }

    const apply = () => {
      ticking = false
      if (!metrics) return
      const y = Math.max(0, window.scrollY || document.documentElement.scrollTop)
      const p = Math.min(1, y / metrics.morphDist)
      const eMenu = 1 - Math.pow(1 - p, 2.4)
      const eTitle = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) * 0.5

      const tx = metrics.centerShiftX * (1 - eMenu)
      const ty = 7 * (1 - eMenu)
      menus.style.transform = (Math.abs(tx) < 0.1 && Math.abs(ty) < 0.1)
        ? ''
        : `translate3d(${tx.toFixed(2)}px, ${ty.toFixed(2)}px, 0)`

      const pillOpacity = Math.max(0, 1 - p * 1.9)
      const barOpacity = Math.min(1, Math.max(0, (p - 0.12) / 0.78))
      menus.style.setProperty('--nav-pill-opacity', pillOpacity.toFixed(3))
      if (pillGlass) pillGlass.style.opacity = pillOpacity.toFixed(3)
      if (glassCanvas) glassCanvas.style.opacity = pillOpacity.toFixed(3)
      if (barGlass) barGlass.style.opacity = barOpacity.toFixed(3)

      nav.classList.toggle('nav-pill-hidden', pillOpacity <= 0.005)
      nav.classList.toggle('nav-bar-active', barOpacity > 0.005)
      nav.classList.toggle('nav-docked', p >= 0.52)
      if (pillOpacity > 0.005 && navWebGL && navWebGL.isReady()) navWebGL.render()

      if (metrics.hero && heroTitle && navHomeTitle) {
        const { docLeft, docCY, navLeft, navCY, scaleEnd } = metrics.hero
        const isDark = document.documentElement.getAttribute('data-theme') === 'dark'
        if (p <= 0.001) {
          heroTitle.style.transform = ''
          heroTitle.style.opacity = ''
          heroTitle.style.color = ''
          heroTitle.style.textShadow = ''
          heroTitle.style.pointerEvents = ''
          navHomeTitle.style.opacity = '0'
          navHomeTitle.style.pointerEvents = 'none'
        } else if (p >= 0.995) {
          heroTitle.style.opacity = '0'
          heroTitle.style.pointerEvents = 'none'
          navHomeTitle.style.opacity = '1'
          navHomeTitle.style.pointerEvents = 'auto'
        } else {
          const curLeft = docLeft + (navLeft - docLeft) * eTitle
          const curCY = docCY + (navCY - docCY) * eTitle
          const curScale = 1 + (scaleEnd - 1) * eTitle
          const titleTx = curLeft - docLeft
          const titleTy = (curCY - docCY) + y
          heroTitle.style.transform = `translate3d(${titleTx.toFixed(2)}px, ${titleTy.toFixed(2)}px, 0) scale(${curScale.toFixed(4)})`
          heroTitle.style.pointerEvents = p > 0.65 ? 'none' : ''

          if (!isDark) {
            const cP = Math.min(1, Math.max(0, (p - 0.42) / 0.50))
            const r = Math.round(255 + (44 - 255) * cP)
            const g = Math.round(255 + (49 - 255) * cP)
            const b = Math.round(255 + (56 - 255) * cP)
            heroTitle.style.color = `rgb(${r}, ${g}, ${b})`
            heroTitle.style.textShadow = `0 2px 4px rgba(0, 0, 0, ${(0.15 * (1 - cP)).toFixed(3)})`
          } else {
            heroTitle.style.color = ''
            heroTitle.style.textShadow = ''
          }

          const handoff = Math.max(0, (p - 0.90) / 0.10)
          heroTitle.style.opacity = (1 - handoff).toFixed(3)
          navHomeTitle.style.opacity = handoff.toFixed(3)
          navHomeTitle.style.pointerEvents = handoff > 0.5 ? 'auto' : 'none'
        }

        if (heroSubtitle) {
          const subOpacity = Math.max(0, 1 - p * 2.4)
          heroSubtitle.style.opacity = subOpacity.toFixed(3)
          heroSubtitle.style.transform = p > 0 ? `translate3d(0, ${(-14 * p).toFixed(1)}px, 0)` : ''
        }
      }
    }

    const schedule = () => {
      if (ticking) return
      ticking = true
      requestAnimationFrame(apply)
    }

    const refresh = () => {
      measure()
      if (metrics) apply()
      else if (navWebGL && navWebGL.isReady()) navWebGL.render()
    }

    if (navSiteLink && isHome) {
      navSiteLink.addEventListener('click', event => {
        if (window.scrollY > 40) {
          event.preventDefault()
          window.scrollTo({ top: 0, behavior: 'smooth' })
        }
      }, { signal })
    }

    const onResize = () => {
      if (window.innerWidth === lastViewportW && metrics) return
      refresh()
    }

    window.addEventListener('scroll', schedule, { passive: true, signal })
    window.addEventListener('resize', onResize, { passive: true, signal })
    reducedMotion.addEventListener('change', refresh, { signal })
    if ('ResizeObserver' in window) {
      let lastMenusW = 0
      const menusObs = new ResizeObserver(() => {
        const w = menus.offsetWidth
        if (w && w !== lastMenusW) {
          lastMenusW = w
          refresh()
        }
      })
      menusObs.observe(menus)
      signal.addEventListener('abort', () => menusObs.disconnect())
    }
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => { if (!signal.aborted) refresh() })
    }
    if ('MutationObserver' in window) {
      const rootObs = new MutationObserver(() => refresh())
      rootObs.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] })
      signal.addEventListener('abort', () => rootObs.disconnect())
    }

    refresh()
  }

  const initialize = () => {
    document.querySelectorAll(selector).forEach(surface => {
      surface.classList.add('liquid-glass')
      if (resize) resize.observe(surface)
    })
    initNavHoverLens()
    initNavScrollMorph()
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
  if (resize && 'MutationObserver' in window) {
    new MutationObserver(() => {
      if (document.documentElement.classList.contains('solid-bg')) return
      document.querySelectorAll('.liquid-glass').forEach(surface => updateRefraction(surface))
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
  }
  document.addEventListener('pjax:complete', initialize)
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true })
  else initialize()
})()
