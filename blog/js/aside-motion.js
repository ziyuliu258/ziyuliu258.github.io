/* 单双栏切换时给侧栏补一层透明度/位移动画，并躲开逐帧改宽度。 */
(() => {
  if (window.__blogAsideMotion) return
  window.__blogAsideMotion = true

  const root = document.documentElement
  const motionQuery = matchMedia('(prefers-reduced-motion: reduce)')
  const desktopQuery = matchMedia('(min-width: 900px)')
  let timer = 0
  let bound = false

  function settle() {
    if (!root.classList.contains('aside-motion')) return
    clearTimeout(timer)
    root.classList.add('aside-glass-pause')
    root.classList.remove('aside-motion', 'aside-showing', 'aside-hiding')
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        root.classList.remove('aside-glass-pause')
        document.dispatchEvent(new Event('blog:aside-motion-end'))
      })
    })
  }

  function bind() {
    const rightside = document.getElementById('rightside')
    if (!rightside || bound) return
    bound = true

    rightside.addEventListener('click', event => {
      if (!event.target.closest('#hide-aside-btn')) return
      if (motionQuery.matches || !desktopQuery.matches) return
      const aside = document.querySelector('.layout > .aside-content')
      if (!aside) return
      const showing = root.classList.contains('hide-aside')
      root.classList.remove('aside-showing', 'aside-hiding')
      root.classList.add('aside-motion', showing ? 'aside-showing' : 'aside-hiding')
      void aside.offsetWidth
      clearTimeout(timer)
      timer = setTimeout(settle, 420)
    }, true)

    document.addEventListener('animationend', event => {
      if (!root.classList.contains('aside-motion')) return
      if (event.animationName !== 'aside-ink-in' && event.animationName !== 'aside-ink-out') return
      settle()
    })
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind, { once: true })
  else bind()
})()
