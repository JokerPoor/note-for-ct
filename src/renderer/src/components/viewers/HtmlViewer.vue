<script setup>
import { ref, onMounted, watch, defineProps, onBeforeUnmount, computed } from 'vue'
import { ElEmpty, ElAlert } from 'element-plus'

const props = defineProps({
  relativePath: { type: String, required: true },
  allowScripts: { type: Boolean, default: false }
})

const iframeSandbox = computed(() => (props.allowScripts ? 'allow-same-origin allow-scripts' : 'allow-same-origin'))

const htmlContent = ref('')
const errorMsg = ref('')

// 追踪在重写中创建的 Object URL，便于释放
const objectUrls = new Set()
function revokeAllObjectUrls() {
  try { for (const u of objectUrls) URL.revokeObjectURL(u) } catch {}
  objectUrls.clear()
}

function pathJoinAndNorm(baseDir, rel) {
  const a = String(baseDir || '').replace(/\\+/g, '/').replace(/\/[^/]*$/, '/')
  let b = String(rel || '').replace(/\\+/g, '/').replace(/^\/+/, '')
  const segs = (a + b).split('/')
  const out = []
  for (const s of segs) {
    if (!s || s === '.') continue
    if (s === '..') out.pop()
    else out.push(s)
  }
  return out.join('/')
}

function isExternalUrl(u) {
  return /^(data:|[a-zA-Z]+:\/\/|file:\/\/|\/\/)/.test(String(u || ''))
}

function guessImgMime(p) {
  const x = String(p || '').toLowerCase()
  if (x.endsWith('.png')) return 'image/png'
  if (x.endsWith('.jpg') || x.endsWith('.jpeg')) return 'image/jpeg'
  if (x.endsWith('.gif')) return 'image/gif'
  if (x.endsWith('.webp')) return 'image/webp'
  if (x.endsWith('.bmp')) return 'image/bmp'
  if (x.endsWith('.svg')) return 'image/svg+xml'
  return 'application/octet-stream'
}

function guessAssetMimeByPath(p) {
  const x = String(p || '').toLowerCase()
  if (x.endsWith('.png')) return 'image/png'
  if (x.endsWith('.jpg') || x.endsWith('.jpeg')) return 'image/jpeg'
  if (x.endsWith('.gif')) return 'image/gif'
  if (x.endsWith('.webp')) return 'image/webp'
  if (x.endsWith('.bmp')) return 'image/bmp'
  if (x.endsWith('.svg')) return 'image/svg+xml'
  if (x.endsWith('.ico')) return 'image/x-icon'
  if (x.endsWith('.apng')) return 'image/apng'
  if (x.endsWith('.avif')) return 'image/avif'
  if (x.endsWith('.woff2')) return 'font/woff2'
  if (x.endsWith('.woff')) return 'font/woff'
  if (x.endsWith('.ttf')) return 'font/ttf'
  if (x.endsWith('.otf')) return 'font/otf'
  if (x.endsWith('.eot')) return 'application/vnd.ms-fontobject'
  if (x.endsWith('.mp3')) return 'audio/mpeg'
  if (x.endsWith('.m4a')) return 'audio/mp4'
  if (x.endsWith('.wav')) return 'audio/wav'
  if (x.endsWith('.ogg')) return 'audio/ogg'
  if (x.endsWith('.mp4')) return 'video/mp4'
  if (x.endsWith('.webm')) return 'video/webm'
  return 'application/octet-stream'
}

async function rewriteCssUrls(cssText, baseRelPath) {
  if (!cssText) return ''
  const base = String(baseRelPath || '').replace(/\\+/g, '/')
  // 匹配 url(...)，包含可选引号，忽略 data: 或协议链接
  const urlRe = /url\(\s*(["']?)([^\)"']+)\1\s*\)/g
  let out = ''
  let lastIdx = 0
  for (;;) {
    const m = urlRe.exec(cssText)
    if (!m) break
    const full = m[0]
    const raw = m[2] || ''
    out += cssText.slice(lastIdx, m.index)
    lastIdx = m.index + full.length
    if (!raw || isExternalUrl(raw)) {
      out += full
      continue
    }
    try {
      const rel = pathJoinAndNorm(base, raw)
      const r = await window.api?.fsReadFile?.({ relativePath: rel, encoding: 'base64' })
      if (r?.ok && r.content) {
        const mime = guessAssetMimeByPath(rel)
        out += `url(data:${mime};base64,${r.content})`
      } else {
        out += full
      }
    } catch {
      out += full
    }
  }
  out += cssText.slice(lastIdx)
  return out
}

function guessMediaMime(p) {
  const x = String(p || '').toLowerCase()
  if (x.endsWith('.mp3')) return 'audio/mpeg'
  if (x.endsWith('.wav')) return 'audio/wav'
  if (x.endsWith('.flac')) return 'audio/flac'
  if (x.endsWith('.amr')) return 'audio/amr'
  if (x.endsWith('.aac')) return 'audio/aac'
  if (x.endsWith('.ogg')) return 'audio/ogg'
  if (x.endsWith('.m4a')) return 'audio/mp4'
  if (x.endsWith('.opus')) return 'audio/opus'
  if (x.endsWith('.mp4')) return 'video/mp4'
  if (x.endsWith('.webm')) return 'video/webm'
  if (x.endsWith('.mkv')) return 'video/x-matroska'
  if (x.endsWith('.mov')) return 'video/quicktime'
  if (x.endsWith('.avi')) return 'video/x-msvideo'
  if (x.endsWith('.m4v')) return 'video/x-m4v'
  return 'application/octet-stream'
}

async function rewriteHtmlResources(rawHtml, fileRelPath) {
  try {
    const baseDir = String(fileRelPath || '').replace(/\\+/g, '/')
    const parser = new DOMParser()
    const doc = parser.parseFromString(String(rawHtml || ''), 'text/html')

    // 1) 图片内联为 data URL
    const imgs = Array.from(doc.querySelectorAll('img[src]'))
    for (const img of imgs) {
      const src = img.getAttribute('src') || ''
      if (!src || isExternalUrl(src)) continue
      const rel = pathJoinAndNorm(baseDir, src)
      const r = await window.api?.fsReadFile?.({ relativePath: rel, encoding: 'base64' })
      if (r?.ok && r.content) {
        const mime = guessImgMime(rel)
        img.setAttribute('src', `data:${mime};base64,${r.content}`)
        img.setAttribute('data-src-inline', '1')
      }
    }

    // 2) 样式表内联：<link rel="stylesheet" href="...">
    const links = Array.from(doc.querySelectorAll('link[rel="stylesheet"][href]'))
    for (const link of links) {
      const href = link.getAttribute('href') || ''
      if (!href || isExternalUrl(href)) continue
      const rel = pathJoinAndNorm(baseDir, href)
      const r = await window.api?.fsReadFile?.({ relativePath: rel, encoding: 'utf-8' })
      if (r?.ok) {
        const style = doc.createElement('style')
        style.textContent = await rewriteCssUrls(String(r.content || ''), rel)
        link.replaceWith(style)
      }
    }

    // 2.1) 重写内联 <style> 中的 url(...)
    const styleTags = Array.from(doc.querySelectorAll('style'))
    for (const st of styleTags) {
      const css = st.textContent || ''
      if (css) st.textContent = await rewriteCssUrls(css, baseDir)
    }

    // 3) 音/视频：转为 Blob URL（iframe 禁脚本，纯媒体可安全预览）
    const mediaNodes = Array.from(doc.querySelectorAll('audio[src], video[src], source[src]'))
    for (const el of mediaNodes) {
      const src = el.getAttribute('src') || ''
      if (!src || isExternalUrl(src)) continue
      const rel = pathJoinAndNorm(baseDir, src)
      const r = await window.api?.fsReadFile?.({ relativePath: rel, encoding: 'base64' })
      if (r?.ok && r.content) {
        const mime = guessMediaMime(rel)
        const bin = atob(r.content)
        const buf = new Uint8Array(bin.length)
        for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i)
        const blob = new Blob([buf], { type: mime })
        const url = URL.createObjectURL(blob)
        objectUrls.add(url)
        el.setAttribute('src', url)
        el.setAttribute('data-src-inline', '1')
      }
    }

    // 4) 脚本：仅在允许脚本时处理 <script src>
    if (props.allowScripts) {
      const scripts = Array.from(doc.querySelectorAll('script[src]'))
      for (const s of scripts) {
        const src = s.getAttribute('src') || ''
        if (!src || isExternalUrl(src)) continue
        const rel = pathJoinAndNorm(baseDir, src)
        const r = await window.api?.fsReadFile?.({ relativePath: rel, encoding: 'utf-8' })
        if (r?.ok) {
          const blob = new Blob([String(r.content || '')], { type: 'text/javascript' })
          const url = URL.createObjectURL(blob)
          objectUrls.add(url)
          s.setAttribute('src', url)
          s.removeAttribute('integrity')
          s.removeAttribute('crossorigin')
        }
      }
    }

    return doc.documentElement?.outerHTML || String(rawHtml || '')
  } catch {
    return String(rawHtml || '')
  }
}

async function loadHtml() {
  try {
    errorMsg.value = ''
    htmlContent.value = ''
    revokeAllObjectUrls()
    const rel = String(props.relativePath || '').replace(/^\/+|^\\+/, '')
    if (!rel) {
      errorMsg.value = '无效的文件路径'
      return
    }
    const r = await window.api?.fsReadFile?.({ relativePath: rel, encoding: 'utf-8' })
    if (r?.ok) {
      const processed = await rewriteHtmlResources(String(r.content || ''), rel)
      htmlContent.value = processed
    } else {
      errorMsg.value = r?.reason || '读取 HTML 失败'
    }
  } catch (e) {
    errorMsg.value = String(e?.message || e)
  }
}

onMounted(loadHtml)
watch(() => props.relativePath, loadHtml)
watch(() => props.allowScripts, loadHtml)
onBeforeUnmount(revokeAllObjectUrls)
</script>

<template>
  <div class="viewer-root">
    <template v-if="errorMsg">
      <ElAlert :title="'HTML 预览失败：' + errorMsg" type="error" show-icon />
    </template>
    <template v-else-if="htmlContent">
      <iframe
        class="w-full h-full border rounded"
        :srcdoc="htmlContent"
        :sandbox="iframeSandbox"
        title="HTML 预览"
      />
    </template>
    <template v-else>
      <ElEmpty description="加载中…" />
    </template>
  </div>
</template>

<style scoped>
.viewer-root {
  width: 100%;
  height: 100%;
  min-height: 0;
}
.viewer-root iframe {
  width: 100%;
  height: 100%;
}
</style>
