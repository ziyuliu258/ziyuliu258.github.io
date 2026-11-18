/* 阅读模式的线式目录与轻量工具栏；正文交互共用 reading-guide。 */
(() => {
  'use strict'
  const article = document.getElementById('article-container')
  if (!article || document.getElementById('reading-toc')) return
  const nav = document.createElement('nav')
  nav.id = 'reading-toc'
  nav.className = 'reading-only'
  nav.setAttribute('aria-label', '阅读目录')
  const label = document.createElement('div')
  label.className = 'reading-toc-label'
  label.textContent = '目录'
  nav.appendChild(label)
  const headings = [...article.querySelectorAll('h1,h2,h3,h4,h5,h6')]
  const tree = document.createElement('ul')
  nav.appendChild(tree)
  const parents = []
  const links = headings.map(heading => {
    const level = Number(heading.tagName.slice(1))
    while (parents.length && parents[parents.length - 1].level >= level) parents.pop()
    let list = tree
    if (parents.length) {
      const parent = parents[parents.length - 1]
      if (!parent.children) {
        parent.children = document.createElement('ul')
        parent.item.appendChild(parent.children)
      }
      list = parent.children
    }
    const item = document.createElement('li')
    list.appendChild(item)
    const link = document.createElement('a')
    link.href = '#' + encodeURIComponent(heading.id)
    const clone = heading.cloneNode(true)
    clone.querySelectorAll('.headerlink').forEach(node => node.remove())
    link.textContent = clone.textContent.trim()
    link.dataset.heading = heading.id
    item.appendChild(link)
    parents.push({ level, item })
    return link
  })
  document.getElementById('post').after(nav)
  document.addEventListener('reading:section', event => {
    for (const link of links) {
      if (link.dataset.heading === event.detail.id) link.setAttribute('aria-current', 'location')
      else link.removeAttribute('aria-current')
    }
    const active = nav.querySelector('[aria-current]')
    if (active && document.body.classList.contains('read-mode')) {
      const item = active.getBoundingClientRect(), box = nav.getBoundingClientRect()
      if (item.top < box.top || item.bottom > box.bottom) nav.scrollTop += item.top - box.top - nav.clientHeight / 3
    }
  })

  const tools = document.createElement('div')
  tools.className = 'reading-only reading-tools'
  tools.innerHTML = '<button type="button" class="reading-tool reading-export-toggle" title="导出文章" aria-label="导出文章" aria-expanded="false" aria-controls="reading-export-menu"><i class="fas fa-download" aria-hidden="true"></i></button>' +
    '<div id="reading-export-menu" hidden><button type="button" data-export="pdf">PDF <small>打印 / 另存为 PDF</small></button><button type="button" data-export="markdown">Markdown <small>.md</small></button><button type="button" data-export="html">HTML <small>.html</small></button><button type="button" data-export="word">Word <small>.docx</small></button></div><span class="reading-export-status" role="status" aria-live="polite"></span>'
  document.body.appendChild(tools)
  const toggle = tools.querySelector('.reading-export-toggle')
  const menu = tools.querySelector('#reading-export-menu')
  const close = () => { menu.hidden = true; toggle.setAttribute('aria-expanded', 'false') }
  toggle.addEventListener('click', () => {
    menu.hidden = !menu.hidden
    toggle.setAttribute('aria-expanded', String(!menu.hidden))
  })
  document.addEventListener('click', event => { if (!tools.contains(event.target)) close() })
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !menu.hidden) { close(); toggle.focus() }
  })
  tools.addEventListener('click', async event => {
    const option = event.target.closest('[data-export]')
    if (!option || tools.dataset.busy) return
    close()
    tools.dataset.busy = 'true'
    toggle.disabled = true
    const status = tools.querySelector('.reading-export-status')
    status.textContent = '正在准备导出…'
    try {
      if (!window.liquidExportArticle) throw new Error('导出组件尚未加载，请稍后重试')
      const result = await window.liquidExportArticle(option.dataset.export)
      status.textContent = result || '文件已生成'
    } catch (error) {
      status.textContent = '导出失败：' + error.message
    } finally {
      delete tools.dataset.busy
      toggle.disabled = false
    }
  })
  const top = document.createElement('button')
  top.type = 'button'
  top.className = 'reading-only reading-tool reading-top'
  top.title = '回到顶部'
  top.setAttribute('aria-label', '回到顶部')
  top.innerHTML = '<i class="fas fa-arrow-up" aria-hidden="true"></i>'
  top.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }))
  document.body.appendChild(top)
})()
