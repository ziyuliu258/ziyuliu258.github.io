/* 独立文档导出：PDF 交给浏览器排版，HTML 内嵌图片，Word 生成真正的 DOCX。 */
(() => {
  'use strict'
  const article = document.getElementById('article-container')
  if (!article) return
  const title = () => {
    const heading = document.querySelector('#post-info .post-title')?.cloneNode(true)
    if (!heading) return document.title
    heading.querySelectorAll('.katex').forEach(node => node.replaceWith(document.createTextNode(node.querySelector('.katex-html')?.textContent || node.querySelector('annotation')?.textContent || node.textContent)))
    return heading.textContent.trim()
  }
  const filename = () => title().replace(/[\\/:*?"<>|\x00-\x1f]/g, '-').slice(0, 140)
  const escape = text => String(text).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch])
  const download = (blob, extension) => {
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename() + extension
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 60000)
  }
  const cloneArticle = () => {
    const clone = article.cloneNode(true)
    clone.removeAttribute('style')
    clone.querySelectorAll('.headerlink,.highlight-tools,.copy-notice,script,button,.code-expand-btn').forEach(node => node.remove())
    clone.querySelectorAll('figure.highlight').forEach(figure => {
      const pre = document.createElement('pre')
      pre.textContent = (figure.querySelector('td.code pre') || figure).textContent
      figure.replaceWith(pre)
    })
    clone.querySelectorAll('a[href]').forEach(link => { link.href = new URL(link.getAttribute('href'), location.href).href })
    clone.querySelectorAll('img').forEach(img => {
      img.src = new URL(img.dataset.src || img.getAttribute('src'), location.href).href
      img.removeAttribute('srcset')
      img.removeAttribute('loading')
    })
    return clone
  }
  const dataURL = blob => new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
  const fetchImage = async src => {
    const response = await fetch(src, { signal: AbortSignal.timeout(20000) })
    if (!response.ok) throw new Error('图片请求失败')
    return response.blob()
  }
  const styles = `body{max-width:860px;margin:40px auto;padding:0 24px;color:#292929;background:#fff;font:16px/1.9 Georgia,"Noto Serif SC",serif}h1,h2,h3,h4,h5,h6{line-height:1.45;break-after:avoid}h1{font-size:28px}h2{font-size:23px;margin-top:1.6em}h3{font-size:20px}img,svg{max-width:100%;height:auto}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f5f5f5;padding:16px;font:13px/1.6 monospace}code{font-family:monospace}blockquote{margin-left:0;padding-left:16px;border-left:3px solid #ccc;color:#555}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:6px 10px}a{color:inherit}math{font-size:1.1em}math[display=block]{display:block;margin:1.3em 0}figure{margin:1.4em 0}.source{font:12px/1.5 sans-serif;color:#777}@page{size:A4;margin:20mm}@media print{body{margin:0;padding:0;max-width:none}a{text-decoration:none}img,pre,tr{break-inside:avoid}}`
  // 浏览器页眉页脚占用 @page 的页边距；设为零，在文档内保留可重复的留白。
  const printStyles = `#export-layout>thead,#export-layout>tfoot{display:none}#export-layout>tbody>tr>td{border:0;padding:0}#export-layout{border:0}@page{margin:0}@media print{body{padding:0 20mm}#export-layout>thead{display:table-header-group}#export-layout>tfoot{display:table-footer-group}#export-layout>thead>tr>td,#export-layout>tfoot>tr>td{height:16mm;border:0;padding:0}#export-layout>tbody>tr{break-inside:auto}#export-layout>tbody>tr>td{vertical-align:top}h1{margin-top:0}}`
  const makeHTML = async () => {
    const clone = cloneArticle()
    let missing = 0
    await Promise.all([...clone.querySelectorAll('img')].map(async img => {
      try { img.src = await dataURL(await fetchImage(img.src)) } catch { missing++ }
    }))
    // 使用浏览器原生 MathML，离线文件不依赖 KaTeX 字体或脚本。
    clone.querySelectorAll('.katex-display').forEach(node => {
      const math = node.querySelector('math')
      if (math) { math.setAttribute('display', 'block'); node.replaceWith(math) }
    })
    clone.querySelectorAll('.katex').forEach(node => {
      const math = node.querySelector('math')
      if (math) node.replaceWith(math)
    })
    const html = '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + escape(title()) + '</title><style>' + styles + printStyles + '</style></head><body><table id="export-layout" role="presentation"><thead><tr><td></td></tr></thead><tbody><tr><td><h1>' + escape(title()) + '</h1><p class="source">源网址：' + escape(location.href.split('#')[0]) + '</p><article>' + clone.innerHTML + '</article></td></tr></tbody><tfoot><tr><td></td></tr></tfoot></table></body></html>'
    return { html, missing }
  }
  let docxPromise
  const loadDocx = () => {
    if (window.docx) return Promise.resolve(window.docx)
    if (!docxPromise) docxPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script')
      script.src = ((typeof GLOBAL_CONFIG !== 'undefined' && GLOBAL_CONFIG.root) || '/') + 'vendor/extsrc/docx.js'
      script.onload = () => window.docx ? resolve(window.docx) : reject(new Error('Word 组件加载失败'))
      script.onerror = () => { docxPromise = null; script.remove(); reject(new Error('Word 组件加载失败，请重试')) }
      document.head.appendChild(script)
    })
    return docxPromise
  }
  const makeWord = async () => {
    const d = await loadDocx()
    const clone = cloneArticle()
    let missing = 0
    let mathFallbacks = 0
    // 将常见 MathML 结构转换为 Word 原生可编辑公式；复杂结构保留 LaTeX。
    const mathRuns = node => {
      if (!node) return []
      if (node.nodeType === Node.TEXT_NODE) return node.textContent.trim() ? [new d.MathRun(node.textContent)] : []
      const tag = node.localName
      const children = [...node.children]
      const part = index => mathRuns(children[index])
      if (tag === 'semantics') return part(0)
      if (['annotation', 'annotation-xml'].includes(tag)) return []
      if (['math', 'mrow', 'mstyle', 'mpadded', 'mphantom'].includes(tag)) return children.flatMap(mathRuns)
      if (['mi', 'mn', 'mo', 'mtext', 'ms'].includes(tag)) return [new d.MathRun(node.textContent)]
      if (tag === 'mspace') return [new d.MathRun(' ')]
      if (tag === 'mfrac') return [new d.MathFraction({ numerator: part(0), denominator: part(1) })]
      if (tag === 'msub') return [new d.MathSubScript({ children: part(0), subScript: part(1) })]
      if (tag === 'msup') return [new d.MathSuperScript({ children: part(0), superScript: part(1) })]
      if (tag === 'msubsup') return [new d.MathSubSuperScript({ children: part(0), subScript: part(1), superScript: part(2) })]
      if (tag === 'msqrt') return [new d.MathRadical({ children: children.flatMap(mathRuns) })]
      if (tag === 'mroot') return [new d.MathRadical({ children: part(0), degree: part(1) })]
      if (tag === 'munder') return [new d.MathLimitLower({ children: part(0), limit: part(1) })]
      if (tag === 'mover' && node.getAttribute('accent') !== 'true') return [new d.MathLimitUpper({ children: part(0), limit: part(1) })]
      if (tag === 'munderover') return [new d.MathLimitUpper({ children: [new d.MathLimitLower({ children: part(0), limit: part(1) })], limit: part(2) })]
      throw new Error('复杂公式保留源码')
    }
    const runs = async (node, format = {}) => {
      if (node.nodeType === Node.TEXT_NODE) return [new d.TextRun({ text: node.textContent, ...format })]
      if (node.nodeType !== Node.ELEMENT_NODE) return []
      if (node.classList.contains('katex') || node.classList.contains('katex-display')) {
        try { return [new d.Math({ children: mathRuns(node.querySelector('math')) })] } catch {
          mathFallbacks++
          return [new d.TextRun(node.querySelector('annotation')?.textContent || node.textContent)]
        }
      }
      const tag = node.tagName
      if (tag === 'BR') return [new d.TextRun({ break: 1 })]
      if (tag === 'IMG') {
        try {
          const blob = await fetchImage(node.src)
          const bitmap = await createImageBitmap(blob)
          const scale = Math.min(1, 600 / bitmap.width)
          const width = Math.round(bitmap.width * scale), height = Math.round(bitmap.height * scale)
          const canvas = document.createElement('canvas')
          canvas.width = width; canvas.height = height
          canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height)
          bitmap.close()
          const png = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
          return [new d.ImageRun({ data: new Uint8Array(await png.arrayBuffer()), type: 'png', transformation: { width, height } })]
        } catch { missing++; return [new d.TextRun('[图片：' + (node.alt || node.src) + ']')] }
      }
      const next = { ...format }
      if (tag === 'STRONG' || tag === 'B') next.bold = true
      if (tag === 'EM' || tag === 'I') next.italics = true
      if (tag === 'CODE') next.font = 'Consolas'
      const children = (await Promise.all([...node.childNodes].map(child => runs(child, next)))).flat()
      if (tag === 'A' && /^https?:/.test(node.href)) return [new d.ExternalHyperlink({ link: node.href, children })]
      return children
    }
    const blocks = async root => {
      const result = []
      for (const node of root.childNodes) {
        if (node.nodeType === Node.TEXT_NODE) {
          if (node.textContent.trim()) result.push(new d.Paragraph({ children: await runs(node) }))
          continue
        }
        if (node.nodeType !== Node.ELEMENT_NODE) continue
        const tag = node.tagName
        if (tag === 'TABLE') {
          const rows = []
          for (const row of node.rows) {
            const cells = []
            for (const cell of row.cells) cells.push(new d.TableCell({ children: [new d.Paragraph({ children: await runs(cell, { bold: cell.tagName === 'TH' }) })] }))
            rows.push(new d.TableRow({ children: cells }))
          }
          if (rows.length) result.push(new d.Table({ rows, width: { size: 100, type: d.WidthType.PERCENTAGE } }))
        } else if (tag === 'UL' || tag === 'OL') {
          let index = 1
          for (const li of node.children) {
            const text = li.cloneNode(true)
            text.querySelectorAll('ul,ol').forEach(list => list.remove())
            result.push(new d.Paragraph({ children: [new d.TextRun(tag === 'OL' ? index++ + '. ' : '• '), ...await runs(text)], indent: { left: 360 } }))
            for (const list of li.children) if (/^(UL|OL)$/.test(list.tagName)) {
              const wrapper = document.createElement('div'); wrapper.appendChild(list.cloneNode(true))
              result.push(...await blocks(wrapper))
            }
          }
        } else if (/^H[1-6]$/.test(tag)) {
          result.push(new d.Paragraph({ heading: d.HeadingLevel['HEADING_' + tag.slice(1)], children: await runs(node) }))
        } else if (tag === 'PRE') {
          for (const line of node.textContent.split('\n')) result.push(new d.Paragraph({ children: [new d.TextRun({ text: line || ' ', font: 'Consolas', size: 19 })] }))
        } else if (/^(DIV|SECTION|BLOCKQUOTE|FIGURE)$/.test(tag)) result.push(...await blocks(node))
        else result.push(new d.Paragraph({ children: await runs(node), spacing: { after: 160 } }))
      }
      return result
    }
    const doc = new d.Document({ creator: document.querySelector('meta[name="author"]')?.content || '', title: title(), styles: { default: { document: { run: { font: '宋体', size: 24 }, paragraph: { spacing: { line: 360 } } } }, headings: { heading1: { run: { color: '292929' } }, heading2: { run: { color: '292929' } }, heading3: { run: { color: '292929' } } } }, sections: [{ children: [new d.Paragraph({ text: title(), heading: d.HeadingLevel.TITLE }), new d.Paragraph({ text: '源网址：' + location.href.split('#')[0] }), ...await blocks(clone)] }] })
    download(await d.Packer.toBlob(doc), '.docx')
    return 'Word 已生成' + (mathFallbacks ? '，' + mathFallbacks + ' 个复杂公式保留为 LaTeX' : '（含可编辑公式）') + (missing ? '，' + missing + ' 张图片未能嵌入' : '')
  }
  window.liquidExportArticle = async format => {
    if (format === 'markdown') {
      if (!window.liquidArticleMarkdown) throw new Error('Markdown 组件尚未加载')
      const markdown = '# ' + title() + '\n\n' + window.liquidArticleMarkdown(article) + '\n'
      download(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }), '.md')
      return 'Markdown 已生成（图片使用原文链接）'
    }
    if (format === 'word') return makeWord()
    const { html, missing } = await makeHTML()
    if (format === 'html') {
      download(new Blob([html], { type: 'text/html;charset=utf-8' }), '.html')
      return missing ? 'HTML 已生成，' + missing + ' 张图片保留在线链接' : 'HTML 已生成（图片已嵌入）'
    }
    if (format === 'pdf') {
      document.getElementById('reading-print-frame')?.remove()
      const frame = document.createElement('iframe')
      frame.id = 'reading-print-frame'
      frame.title = '文章打印预览'
      frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:900px;height:700px;border:0'
      const loaded = new Promise(resolve => { frame.onload = resolve })
      frame.srcdoc = html
      document.body.appendChild(frame)
      await loaded
      await frame.contentDocument.fonts.ready
      await Promise.all([...frame.contentDocument.images].map(img => img.decode().catch(() => {})))
      frame.contentWindow.focus()
      frame.contentWindow.print()
      return '请在打印窗口选择“另存为 PDF”' + (missing ? '；部分外链图片未能嵌入' : '')
    }
    throw new Error('不支持的导出格式')
  }
})()
