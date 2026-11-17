/* 阅读指引：
 * 1. 文章标题悬停时标记 H1/H2/... 层级（CSS 读取 data-heading-level）。
 * 2. 滚动时在导航下方显示当前所在的最小级章节标题。
 * 3. 点击标题把它滚到页眉正下方。
 */
(() => {
  'use strict'

  if (window.__blogReadingGuide) return
  window.__blogReadingGuide = true

  const article = document.getElementById('article-container')
  if (!article) return

  const headings = Array.from(article.querySelectorAll('h1, h2, h3, h4, h5, h6'))
  if (!headings.length) return

  const NAV_HEIGHT = 60
  const OFFSET = 16

  const label = heading => {
    heading.setAttribute('data-heading-level', heading.tagName)
  }

  const titleOf = heading => {
    const clone = heading.cloneNode(true)
    clone.querySelectorAll('.headerlink, .katex-html').forEach(node => {
      if (node.classList.contains('headerlink')) node.remove()
    })
    const text = (clone.textContent || '').replace(/\u200b/g, '').replace(/\s+/g, ' ').trim()
    return text
  }

  headings.forEach(heading => {
    label(heading)
    if (!heading.id) {
      const slug = titleOf(heading).replace(/\s+/g, '-')
      if (slug) heading.id = slug
    }
  })

  const guide = document.createElement('div')
  guide.id = 'reading-guide'
  guide.setAttribute('aria-hidden', 'true')
  guide.innerHTML = '<div class="reading-guide-inner">' +
    '<span class="reading-guide-level"></span>' +
    '<span class="reading-guide-title"></span>' +
    '</div>'
  document.body.appendChild(guide)

  const levelEl = guide.querySelector('.reading-guide-level')
  const titleEl = guide.querySelector('.reading-guide-title')

  let ticking = false
  let currentHeading = null

  const update = () => {
    ticking = false
    const threshold = window.scrollY + NAV_HEIGHT + OFFSET
    let found = null

    for (const heading of headings) {
      const top = heading.getBoundingClientRect().top + window.scrollY
      if (top <= threshold) found = heading
      else break
    }

    if (!found || window.scrollY < 80) {
      guide.classList.remove('is-visible')
      guide.setAttribute('aria-hidden', 'true')
      return
    }

    if (found !== currentHeading) {
      currentHeading = found
      levelEl.textContent = found.tagName
      titleEl.textContent = titleOf(found)
    }

    guide.classList.add('is-visible')
    guide.setAttribute('aria-hidden', 'false')
  }

  const onScroll = () => {
    if (ticking) return
    ticking = true
    window.requestAnimationFrame(update)
  }

  window.addEventListener('scroll', onScroll, { passive: true })
  window.addEventListener('resize', onScroll)
  update()

  // 点击标题（含锚点图标）把它滚到页眉下方，而不是贴到屏幕最顶。
  article.addEventListener('click', event => {
    const heading = event.target.closest('h1, h2, h3, h4, h5, h6')
    if (!heading || !article.contains(heading)) return

    const selection = window.getSelection()
    if (selection && !selection.isCollapsed) return

    event.preventDefault()
    const top = heading.getBoundingClientRect().top + window.scrollY - NAV_HEIGHT - OFFSET
    window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' })
    if (heading.id) window.history.replaceState(null, '', '#' + heading.id)
  })
})()
