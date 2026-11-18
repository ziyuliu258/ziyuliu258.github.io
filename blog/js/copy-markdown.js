/* 复制正文时输出 Markdown 源码：公式还原成 $ / $$，引用还原成 >，代码块还原成围栏。 */
(() => {
  'use strict'

  if (window.__blogMarkdownCopy) return
  window.__blogMarkdownCopy = true

  if (typeof window.TurndownService !== 'function') return

  const service = new window.TurndownService({
    headingStyle: 'atx',
    hr: '---',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    fence: '```',
    emDelimiter: '*',
    strongDelimiter: '**',
    linkStyle: 'inlined'
  })

  if (window.turndownPluginGfm && typeof window.turndownPluginGfm.gfm === 'function') {
    service.use(window.turndownPluginGfm.gfm)
  }

  service.remove(['script', 'style', 'noscript'])

  const texOf = node => {
    const annotation = node.querySelector('annotation[encoding="application/x-tex"]')
    return (annotation ? annotation.textContent : node.textContent || '').trim()
  }

  // 行内公式先加，块级公式后加（turndown 后加入的规则优先）。
  service.addRule('katexInline', {
    filter: node => node.nodeName === 'SPAN' && node.classList && node.classList.contains('katex'),
    replacement: (content, node) => '$' + texOf(node) + '$'
  })

  service.addRule('katexDisplay', {
    filter: node => node.nodeName === 'SPAN' && node.classList && node.classList.contains('katex-display'),
    replacement: (content, node) => '\n\n$$\n' + texOf(node) + '\n$$\n\n'
  })

  // 主题的代码块结构是 figure.highlight.<lang> > table > td.code > pre
  service.addRule('highlightBlock', {
    filter: node => node.nodeName === 'FIGURE' && node.classList && node.classList.contains('highlight'),
    replacement: (content, node) => {
      const language = Array.from(node.classList).find(name => name !== 'highlight') || ''
      const codeNode = node.querySelector('td.code pre') || node.querySelector('pre') || node
      const code = codeNode.textContent.replace(/\s+$/, '')
      return '\n\n```' + language + '\n' + code + '\n```\n\n'
    }
  })

  service.addRule('absoluteImages', {
    filter: 'img',
    replacement: (content, node) => {
      const src = node.getAttribute('src') || ''
      if (!src) return ''
      const url = new URL(src, window.location.href).href
      const alt = node.getAttribute('alt') || ''
      const title = node.getAttribute('title')
      return '![' + alt + '](' + url + (title ? ' "' + title + '"' : '') + ')'
    }
  })

  service.addRule('absoluteLinks', {
    filter: 'a',
    replacement: (content, node) => {
      const href = node.getAttribute('href') || ''
      const text = content.trim()
      if (!href || !text) return text
      if (href.startsWith('#') || href.startsWith('javascript:')) return text
      return '[' + text + '](' + new URL(href, window.location.href).href + ')'
    }
  })

  const ARTICLE = '#article-container'

  const toMarkdown = range => {
    const holder = document.createElement('div')
    holder.appendChild(range.cloneContents())
    holder.querySelectorAll('.copy-notice, .highlight-tools, .katex-html').forEach(node => node.remove())
    return service.turndown(holder.innerHTML).replace(/\n{3,}/g, '\n\n').trim()
  }

  window.liquidArticleMarkdown = element => {
    const range = document.createRange()
    range.selectNodeContents(element)
    return toMarkdown(range)
  }

  const withCopyright = markdown => {
    const config = window.GLOBAL_CONFIG && window.GLOBAL_CONFIG.copyright
    if (!config || !config.limitCount || !config.languages) return markdown
    if (markdown.length <= config.limitCount) return markdown
    const { languages } = config
    return markdown + '\n\n\n' + languages.author +
      '\n' + languages.link + window.location.href +
      '\n' + languages.source +
      '\n' + languages.info
  }

  document.addEventListener('copy', event => {
    if (typeof GLOBAL_CONFIG !== 'undefined' && GLOBAL_CONFIG.copy && GLOBAL_CONFIG.copy.enable === false) return
    const article = document.querySelector(ARTICLE)
    const selection = window.getSelection()
    if (!article || !selection || selection.isCollapsed || !selection.rangeCount) return

    const range = selection.getRangeAt(0)
    if (!article.contains(range.commonAncestorContainer)) return

    let markdown
    try {
      markdown = toMarkdown(range)
    } catch (error) {
      return // 转换失败就保留浏览器默认行为
    }
    if (!markdown) return

    event.preventDefault()
    event.stopPropagation()
    event.clipboardData.setData('text/plain', withCopyright(markdown))
  }, true)
})()
