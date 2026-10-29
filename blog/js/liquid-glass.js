/* Glass pointer lighting and dynamic prismatic edge angle; no continuous animation loop. */
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

  const reset = () => {
    cancelAnimationFrame(frame)
    frame = 0
    if (active) {
      active.style.removeProperty('--glass-glow-opacity')
      active.style.removeProperty('--glass-x')
      active.style.removeProperty('--glass-y')
      active.style.removeProperty('--glass-angle')
      active = null
    }
  }

  const initialize = () => {
    reset()
    document.querySelectorAll(selector).forEach(surface => {
      surface.classList.add('liquid-glass')
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
      const relX = x - rect.left
      const relY = y - rect.top
      const dx = relX - rect.width / 2
      const dy = relY - rect.height / 2
      const angle = Math.round((Math.atan2(dy, dx) * 180 / Math.PI + 450) % 360)
      active.style.setProperty('--glass-x', `${relX}px`)
      active.style.setProperty('--glass-y', `${relY}px`)
      active.style.setProperty('--glass-angle', `${angle}deg`)
      active.style.setProperty('--glass-glow-opacity', '0.92')
    })
  }, { passive: true })

  document.addEventListener('pointerout', event => {
    if (active && (!event.relatedTarget || !active.contains(event.relatedTarget))) reset()
  }, { passive: true })
  window.addEventListener('scroll', reset, { passive: true })
  window.addEventListener('blur', reset)
  for (const preference of [pointer, reducedMotion, reducedTransparency]) {
    preference.addEventListener('change', reset)
  }
  document.addEventListener('pjax:complete', initialize)
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true })
  else initialize()
})()
