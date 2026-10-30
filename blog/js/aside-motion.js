/* 单双栏：侧栏出现时只让文字浮现；收成单栏时主栏变宽，正文随宽度折行。 */
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
    document.querySelector('.layout > .aside-content')?.style.removeProperty('--aside-freeze')
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
      if (!showing) {
        const style = getComputedStyle(aside)
        const inner = aside.clientWidth - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0)
        aside.style.setProperty('--aside-freeze', `${Math.round(inner)}px`)
      }
      root.classList.remove('aside-showing', 'aside-hiding')
      root.classList.add('aside-motion', showing ? 'aside-showing' : 'aside-hiding')
      void aside.offsetWidth
      clearTimeout(timer)
      timer = setTimeout(settle, 520)
    }, true)

    document.addEventListener('animationend', event => {
      if (!root.classList.contains('aside-showing')) return
      if (event.animationName !== 'aside-ink-in') return
      settle()
    })

    document.addEventListener('transitionend', event => {
      if (!root.classList.contains('aside-hiding')) return
      if (event.propertyName !== 'width') return
      if (!(event.target instanceof Element) || !event.target.matches('.layout > div:first-child')) return
      settle()
    })
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind, { once: true })
  else bind()
})()
