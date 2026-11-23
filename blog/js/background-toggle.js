/* Swap the site image background for a solid color.
   Light and dark mode each keep the color configured in liquid.background. */
(() => {
  'use strict'

  if (window.__blogBackgroundToggle) return
  window.__blogBackgroundToggle = true

  const config = ((window.GLOBAL_CONFIG_SITE || {}).liquid || {}).background || {}
  if (!config.toggle) return

  const storageKey = 'blog-bg-mode'
  const root = document.documentElement
  const light = config.light || '#efefef'
  const dark = config.dark || '#1e1e1e'

  const saved = () => {
    try {
      return window.btf && btf.saveToLocal ? btf.saveToLocal.get(storageKey) : undefined
    } catch (error) {
      return undefined
    }
  }

  const remember = value => {
    if (window.btf && btf.saveToLocal) btf.saveToLocal.set(storageKey, value, 365)
  }

  const paint = solid => {
    const night = root.getAttribute('data-theme') === 'dark'
    root.style.setProperty('--solid-bg', night ? dark : light)
    root.style.setProperty('--solid-fg', night ? 'rgba(255, 255, 255, .82)' : '#2c3138')
    root.classList.toggle('solid-bg', solid)

    const button = document.getElementById('bg-toggle')
    if (!button) return
    button.classList.toggle('is-solid', solid)
    button.setAttribute('aria-pressed', solid ? 'true' : 'false')
  }

  const apply = solid => {
    paint(solid)
    if (!solid && config.image) {
      const background = document.getElementById('web_bg')
      if (background && config.avif && !background.dataset.bgImageRestored) {
        const imageSet = `image-set(url("${config.avif}") type("image/avif"), url("${config.image}") type("image/jpeg"))`
        background.style.backgroundImage = imageSet
        background.dataset.bgImageRestored = '1'
      }
    }
  }

  // 没有记录时默认纯色，只有明确选过图片才保留图片背景。
  const boot = () => apply(saved() !== 'image')

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true })
  } else {
    boot()
  }

  document.addEventListener('click', event => {
    if (!event.target.closest('#bg-toggle')) return
    const nextSolid = !root.classList.contains('solid-bg')
    apply(nextSolid)
    remember(nextSolid ? 'solid' : 'image')
  })

  new MutationObserver(() => {
    if (root.classList.contains('solid-bg')) paint(true)
  }).observe(root, { attributes: true, attributeFilter: ['data-theme'] })
})()
