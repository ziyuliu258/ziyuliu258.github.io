/* 阅读辅助：
 * 1. 文章标题悬停时标记 H1/H2/... 层级（CSS 读取 data-heading-level）。
 * 2. 点击标题或目录项，滚到页眉正下方，并把 #章节 写进地址栏。
 * 3. 打开带 #章节 的链接时，等页面稳定后定位到同一位置。
 * 4. 当前章节文字置顶，与正文共享卡片背景，点击返回原始标题。
 */
(() => {
  'use strict'

  if (window.__blogReadingGuide) return
  window.__blogReadingGuide = true

  const article = document.getElementById('article-container')
  if (!article) return

  const headings = Array.from(article.querySelectorAll('h1, h2, h3, h4, h5, h6'))
  if (!headings.length) return

  let NAV_HEIGHT = 60
  // 定位后标题正好落在吸附位置附近，切换时不会有空白带。
  const OFFSET = 6

  const titleOf = heading => {
    const clone = heading.cloneNode(true)
    const link = clone.querySelector('.headerlink')
    if (link) link.remove()
    return (clone.textContent || '').replace(/\u200b/g, '').replace(/\s+/g, ' ').trim()
  }

  // 按每行文字的实际边界命中，不把块级标题的整行留白当作链接。
  const hitsText = (element, event) => {
    if (event.detail === 0) return true // 保留键盘激活。
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    const range = document.createRange()
    let node
    while ((node = walker.nextNode())) {
      if (!node.textContent.trim() || node.parentElement.closest('.headerlink')) continue
      range.selectNodeContents(node)
      for (const rect of range.getClientRects()) {
        if (event.clientX >= rect.left && event.clientX <= rect.right &&
            event.clientY >= rect.top && event.clientY <= rect.bottom) return true
      }
    }
    return false
  }

  headings.forEach(heading => {
    heading.setAttribute('data-heading-level', heading.tagName)
    if (!heading.id) {
      const slug = titleOf(heading).replace(/\s+/g, '-')
      if (slug) heading.id = slug
    }
  })

  // 置顶文字与正文共享 #post 的背景，不再绘制第二层玻璃。
  const rail = document.createElement('div')
  rail.id = 'reading-heading-rail'
  rail.className = 'reading-heading-rail'
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'reading-heading-button'
  rail.appendChild(button)
  article.before(rail)

  let headingTops = []
  let articleTop = 0
  let articleBottom = 0
  let railHeight = 0
  let currentIndex = -1
  let guideTicking = false

  const measureHeadings = () => {
    NAV_HEIGHT = document.body.classList.contains('read-mode') ? 20 : 60
    headingTops = headings.map(heading => heading.getBoundingClientRect().top + window.scrollY)
    const rect = article.getBoundingClientRect()
    articleTop = rect.top + window.scrollY
    articleBottom = articleTop + rect.height
    currentIndex = -1
    updateCurrent()
  }

  const updateCurrent = () => {
    guideTicking = false
    const threshold = window.scrollY + NAV_HEIGHT

    let index = -1
    for (let i = 0; i < headingTops.length; i++) {
      if (headingTops[i] <= threshold) index = i
      else break
    }
    // 下一标题进入置顶区域时让出空间；点击返回后原始标题不会被上节挡住。
    if (index >= 0 && headingTops[index + 1] <= threshold + railHeight + OFFSET) index = -1
    if (threshold >= articleBottom - railHeight) index = -1
    button.hidden = index < 0
    if (index !== currentIndex) {
      if (index >= 0) {
        const heading = headings[index]
        button.textContent = titleOf(heading)
        button.setAttribute('aria-label', '返回章节：' + titleOf(heading))
        const style = getComputedStyle(heading)
        button.style.font = style.font
        button.style.letterSpacing = style.letterSpacing
        railHeight = button.getBoundingClientRect().height
      }
      currentIndex = index
      document.dispatchEvent(new CustomEvent('reading:section', { detail: { id: index >= 0 ? headings[index].id : '' } }))
    }
    const cut = index < 0 ? 0 : Math.max(0, threshold + railHeight - articleTop)
    article.style.clipPath = cut ? 'inset(' + cut + 'px -40px 0)' : ''
  }

  button.hidden = true
  button.addEventListener('click', event => {
    if (currentIndex < 0 || !hitsText(button, event)) return
    const heading = headings[currentIndex]
    scrollToHeading(heading, false)
    window.history.pushState(null, '', '#' + heading.id)
  })
  measureHeadings()
  window.addEventListener('resize', measureHeadings, { passive: true })
  window.addEventListener('load', measureHeadings)
  const layoutObserver = new ResizeObserver(measureHeadings)
  layoutObserver.observe(article)
  const pageHeader = document.getElementById('page-header')
  if (pageHeader) layoutObserver.observe(pageHeader)
  new MutationObserver(measureHeadings).observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] })
  new MutationObserver(measureHeadings).observe(document.body, { attributes: true, attributeFilter: ['class'] })
  if (document.fonts) document.fonts.ready.then(measureHeadings)

  window.addEventListener('scroll', () => {
    if (guideTicking) return
    guideTicking = true
    window.requestAnimationFrame(updateCurrent)
  }, { passive: true })
  updateCurrent()

  const scrollToHeading = (heading, smooth) => {
    measureHeadings()
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
    if (fromArticle && !hitsText(heading, event)) {
      event.preventDefault()
      event.stopPropagation()
      return
    }
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

  // 页眉高度只在加载和改变窗口时量一次，避免每帧读取触发重排。
  let collapseRange = 320
  const measureCollapseRange = () => {
    collapseRange = Math.max(160, (header ? header.offsetHeight : 400) - NAV_HEIGHT)
  }
  measureCollapseRange()
  window.addEventListener('resize', measureCollapseRange, { passive: true })

  const updateTitleCollapse = () => {
    titleTicking = false
    if (!postTitle) return

    const progress = Math.min(1, Math.max(0, window.scrollY / collapseRange))
    if (progress >= 1) {
      if (postTitle.style.opacity !== '0') postTitle.style.opacity = '0'
      return
    }

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
