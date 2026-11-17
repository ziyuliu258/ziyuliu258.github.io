/* 阅读辅助：
 * 1. 文章标题悬停时标记 H1/H2/... 层级（CSS 读取 data-heading-level）。
 * 2. 点击标题把它滚到页眉正下方。
 * 3. 最高一级的章节标题在滚动时吸附在导航下方，正文从它下面继续滚过。
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

  const titleOf = heading => {
    const clone = heading.cloneNode(true)
    const link = clone.querySelector('.headerlink')
    if (link) link.remove()
    return (clone.textContent || '').replace(/\u200b/g, '').replace(/\s+/g, ' ').trim()
  }

  const levels = headings.map(heading => Number(heading.tagName.slice(1)))
  const topLevel = Math.min.apply(null, levels)

  headings.forEach(heading => {
    heading.setAttribute('data-heading-level', heading.tagName)
    if (!heading.id) {
      const slug = titleOf(heading).replace(/\s+/g, '-')
      if (slug) heading.id = slug
    }
    // 只有最高一级的章节吸附；子标题跟着正文滚，避免和父标题互相盖住。
    if (Number(heading.tagName.slice(1)) === topLevel) {
      heading.classList.add('is-sticky-heading')
    }
  })

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
