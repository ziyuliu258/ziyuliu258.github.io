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

  headings.forEach(heading => {
    heading.setAttribute('data-heading-level', heading.tagName)
    if (!heading.id) {
      const slug = titleOf(heading).replace(/\s+/g, '-')
      if (slug) heading.id = slug
    }
    // 所有层级都吸附：滚到哪里，最靠近文段的那一级标题就盖在最上面，
    // 父级标题被压在下层，不会挡住当前的小标题。
    heading.classList.add('is-sticky-heading')
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

  // 页眉里的大标题随滚动缩小、淡出，看起来像收进了导航栏。
  const header = document.getElementById('page-header')
  const postInfo = document.getElementById('post-info')
  const postTitle = postInfo && postInfo.querySelector('.post-title')
  const postMeta = postInfo && postInfo.querySelector('#post-meta')
  let titleTicking = false

  const updateTitleCollapse = () => {
    titleTicking = false
    if (!postTitle) return

    const range = Math.max(160, (header ? header.offsetHeight : 400) - NAV_HEIGHT)
    const progress = Math.min(1, Math.max(0, window.scrollY / range))

    postTitle.style.transformOrigin = 'left top'
    postTitle.style.transform = 'translateY(' + (-14 * progress).toFixed(1) +
      'px) scale(' + (1 - 0.3 * progress).toFixed(3) + ')'
    postTitle.style.opacity = String(Math.max(0, 1 - progress))

    if (postMeta) postMeta.style.opacity = String(Math.max(0, 1 - progress * 1.4))
  }

  window.addEventListener('scroll', () => {
    if (titleTicking) return
    titleTicking = true
    window.requestAnimationFrame(updateTitleCollapse)
  }, { passive: true })
  updateTitleCollapse()

  // 导航栏里的文章名：回到文章开头，而不是回主页。
  const navTitle = document.querySelector('#nav .nav-page-title')
  if (navTitle) {
    navTitle.addEventListener('click', event => {
      event.preventDefault()
      const top = article.getBoundingClientRect().top + window.scrollY - NAV_HEIGHT - OFFSET
      window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' })
    })
  }

  // 返回箭头：回到上一个页面；没有历史时回博客首页。
  const backButton = document.getElementById('nav-back')
  if (backButton) {
    backButton.addEventListener('click', () => {
      if (window.history.length > 1) {
        window.history.back()
      } else {
        window.location.href = (window.GLOBAL_CONFIG && GLOBAL_CONFIG.root) || '/'
      }
    })
  }

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
