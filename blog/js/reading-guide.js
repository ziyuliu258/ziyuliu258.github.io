/* 阅读辅助：
 * 1. 文章标题悬停时标记 H1/H2/... 层级（CSS 读取 data-heading-level）。
 * 2. 点击标题或目录项，滚到页眉正下方，并把 #章节 写进地址栏。
 * 3. 打开带 #章节 的链接时，等页面稳定后定位到同一位置。
 * 4. 最高一级的章节标题在滚动时吸附在导航下方，正文从它下面继续滚过。
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

  const scrollToHeading = (heading, smooth) => {
    const top = heading.getBoundingClientRect().top + window.scrollY - NAV_HEIGHT - OFFSET
    window.scrollTo({ top: Math.max(0, top), behavior: smooth ? 'smooth' : 'auto' })
  }

  const headingForHash = hash => {
    if (!hash || hash === '#') return null
    let id = hash.slice(1)
    try {
      id = decodeURIComponent(id)
    } catch (error) {}
    const target = document.getElementById(id)
    return target && article.contains(target) ? target : null
  }

  // 目录项、标题锚点和标题文字走同一套定位，URL 也会同步成 #章节。
  // 放在捕获阶段，先于主题自己的目录滚动逻辑，避免两次滚动互相抢。
  document.addEventListener('click', event => {
    const link = event.target.closest('a[href^="#"]')
    const heading = event.target.closest('h1, h2, h3, h4, h5, h6')
    const fromArticle = heading && article.contains(heading)
    const target = link ? headingForHash(link.getAttribute('href')) : (fromArticle ? heading : null)
    if (!target) return

    const selection = window.getSelection()
    if (selection && !selection.isCollapsed) return

    event.preventDefault()
    event.stopPropagation()

    scrollToHeading(target, true)
    if (target.id) window.history.pushState(null, '', '#' + target.id)

    // 手机端点完目录顺手把抽屉收起来。
    if (window.innerWidth < 900) {
      const toc = document.getElementById('card-toc')
      if (toc) toc.classList.remove('open')
    }
  }, true)

  // 直接访问带 #章节 的链接：等字体、公式和图片撑开后再校正一次位置。
  const restoreHash = () => {
    const target = headingForHash(window.location.hash)
    if (target) scrollToHeading(target, false)
  }

  if (window.location.hash) {
    window.addEventListener('load', () => {
      restoreHash()
      window.setTimeout(restoreHash, 250)
    })
    window.setTimeout(restoreHash, 80)
  }

  window.addEventListener('hashchange', restoreHash)
})()
