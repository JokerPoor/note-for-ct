<script setup>
// 基于 v-md-editor 的 Markdown 编辑器（Vue 3）
// - 提供 v-model 双向绑定
// - 图片粘贴/拖拽 -> 保存到 Vault -> 插入相对链接
// - 中文日志与异常防护
import {
  onMounted,
  onBeforeUnmount,
  ref,
  watch,
  defineProps,
  defineEmits,
  defineExpose,
  nextTick,
  computed
} from 'vue'
// ByteMD（Vue 3 版本，纯 ESM，兼容严格 CSP）
import { Editor } from '@bytemd/vue-next'
// ByteMD 中文本地化（将工具栏/提示改为中文）
import zhCN from 'bytemd/locales/zh_Hans.json'
import 'bytemd/dist/index.css'
// GFM / 数学公式 / Mermaid 插件
import gfm from '@bytemd/plugin-gfm'
import math from '@bytemd/plugin-math'
import mermaid from 'mermaid'
import mermaidPlugin from '@bytemd/plugin-mermaid'
// 语法高亮（Highlight.js 插件 + 基础样式）
import highlight from '@bytemd/plugin-highlight'
// 数学公式样式（KaTeX）
import 'katex/dist/katex.min.css'
import { createLogger } from '../utils/logger'

const props = defineProps({
  modelValue: { type: String, default: '' },
  readonly: { type: Boolean, default: false },
  // 资源保存的相对目录（基于 Vault 根），例如：assets/images
  assetsDir: { type: String, default: 'assets/images' },
  // 当前笔记相对 Vault 的路径（例如：notes/foo.md），用于就近保存
  currentFilePath: { type: String, default: '' },
  // 预览主题：github | dark | classic | solarized | sepia | nord | ctbb
  theme: { type: String, default: 'github' }
})

// 将预览中的 <audio>/<video>/<source> 的相对 src 重写为 Blob ObjectURL
async function rewritePreviewMedia(rootEl) {
  try {
    const root = rootEl || document
    if (!root) return
    const nodes = Array.from(root.querySelectorAll?.('audio, video, source') || [])
    if (!nodes.length) return
    for (const el of nodes) {
      try {
        const old = el.getAttribute('src') || ''
        if (!old || /^(data:|[a-zA-Z]+:\/\/|file:\/\/|\/\/)/.test(old)) continue
        let rel = old.replace(/^\/+|^\\+/, '')
        try { rel = decodeURI(rel) } catch {}
        const r = await window.api?.fsReadFile?.({ relativePath: rel, encoding: 'base64' })
        if (r?.ok && r.content) {
          const mime = guessMediaMimeByPath(rel)
          // base64 -> Uint8Array -> Blob -> ObjectURL
          const bin = atob(r.content)
          const len = bin.length
          const buf = new Uint8Array(len)
          for (let i = 0; i < len; i++) buf[i] = bin.charCodeAt(i)
          const blob = new Blob([buf], { type: mime })
          const url = URL.createObjectURL(blob)
          mediaObjectUrls.add(url)
          el.setAttribute('src', url)
          el.setAttribute('data-src-inline', '1')
        }
      } catch {}
    }
  } catch {}
}
const emit = defineEmits(['update:modelValue', 'change'])

// ByteMD 插件集合
const plugins = [
  gfm(),
  math(),
  mermaidPlugin({ mermaid }),
  highlight()
]

// 日志器（作用域：MarkdownEditor）
const log = createLogger('MarkdownEditor')
// 主题类名（根据传入 theme 生成根容器 class）
const themeClass = computed(() => `theme-${(props.theme || 'github').toLowerCase()}`)

// 图片粘贴设置（从设置页读取，提供默认值）
let pasteCfg = {
  assetsDir: 'assets/images', // 基于 Vault 的相对目录
  subdirByDate: true, // 是否按 年/月 分目录
  naming: 'timestamp', // 命名：timestamp | original
  nearNoteAssets: false // 是否就近保存到当前笔记同级 assets/
}
// 存放配置变更事件处理器，便于销毁时移除监听，避免内存泄漏
let cfgChangedHandler = null

// =====================
// 预览图像地址重写：将相对路径转换为 file:// 绝对路径
// 说明：Markdown 源文保持相对路径，渲染后在预览 DOM 中将 <img src="notes/..."> 改为 file:///C:/.../vault/notes/...
// =====================
let vaultDirCache = ''
async function getVaultDir() {
  try {
    if (vaultDirCache) return vaultDirCache
    const r = await window.api?.settingsGet?.('vaultDir')
    if (r?.ok && r.value) {
      vaultDirCache = String(r.value)
      await log.debug('已获取 Vault 目录用于图片解析：', vaultDirCache)
    } else {
      await log.warn('获取 Vault 目录失败，图片相对路径可能无法解析显示')
    }
  } catch (e) {
    await log.warn('读取 Vault 目录异常：', String(e?.message || e))
  }
  return vaultDirCache
}

function toFileUrl(absPath) {
  // Windows 路径需要转为 file:///C:/...，并将反斜杠替换为正斜杠
  const norm = String(absPath || '')
    .replace(/\\+/g, '/')
    .replace(/^\/*/, '')
  return 'file:///' + encodeURI(norm)
}

async function resolveImageSrc(src) {
  try {
    const s = String(src || '')
    // 已包含协议或 data: 的跳过
    if (/^(data:|[a-zA-Z]+:\/\/|file:\/\/|\/\/)/.test(s)) return s
    const vault = await getVaultDir()
    if (!vault) return s
    const rel = s.replace(/^\/+|^\\+/, '')
    const abs =
      vault.replace(/\\+$/, '') + (vault.endsWith('\\') || vault.endsWith('/') ? '' : '/') + rel
    return toFileUrl(abs)
  } catch {
    return src
  }
}

function guessMimeByPath(p) {
  try {
    const x = String(p || '').toLowerCase()
    if (x.endsWith('.png')) return 'image/png'
    if (x.endsWith('.jpg') || x.endsWith('.jpeg')) return 'image/jpeg'
    if (x.endsWith('.gif')) return 'image/gif'
    if (x.endsWith('.webp')) return 'image/webp'
    if (x.endsWith('.bmp')) return 'image/bmp'
    if (x.endsWith('.svg')) return 'image/svg+xml'
  } catch {}
  return 'application/octet-stream'
}

// ============ 新增：媒体（音频/视频）MIME 推断与资源重写 ============
function guessMediaMimeByPath(p) {
  try {
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
  } catch {}
  return 'application/octet-stream'
}

// 记录在预览区创建的 Object URL，组件卸载时统一释放
const mediaObjectUrls = new Set()
function revokeAllMediaObjectUrls() {
  try { for (const u of mediaObjectUrls) URL.revokeObjectURL(u) } catch {}
  mediaObjectUrls.clear()
}

async function rewritePreviewImages(rootEl) {
  try {
    const root = rootEl || document
    if (!root) return
    const imgs = root.querySelectorAll?.('img') || []
    if (!imgs.length) {
      try {
        await log.debug('预览区未发现需要处理的图片元素')
      } catch {}
      return
    }
    const vault = await getVaultDir()
    for (const img of imgs) {
      try {
        const old = img.getAttribute('src') || ''
        // 已为绝对/数据 URL 的跳过
        if (!old || /^(data:|[a-zA-Z]+:\/\/|file:\/\/|\/\/)/.test(old)) continue
        if (!vault) continue
        // 读取文件为 base64 并内联，避免 http 页面加载 file:// 受限
        let rel = old.replace(/^\/+|^\\+/, '')
        try {
          rel = decodeURI(rel)
        } catch {}
        const r = await window.api?.fsReadFile?.({ relativePath: rel, encoding: 'base64' })
        if (r?.ok && r.content) {
          const mime = guessMimeByPath(rel)
          const dataUrl = `data:${mime};base64,${r.content}`
          img.setAttribute('src', dataUrl)
          img.setAttribute('data-src-inline', '1')
          await log.debug('已内联图片为 data: URL：', rel)
        } else {
          await log.warn('图片读取失败，无法内联：', rel)
        }
      } catch (e) {
        await log.warn('图片内联过程异常：', String(e?.message || e))
      }
    }
  } catch {}
}

// 监听预览区域 DOM 变更，自动重写新增图片
function setupPreviewObserver(rootEl) {
  try {
    const root = rootEl
    if (!root || typeof MutationObserver === 'undefined') return
    const obs = new MutationObserver(() => {
      try {
        rewritePreviewImages(root)
        rewritePreviewMedia(root)
      } catch {}
    })
    obs.observe(root, { childList: true, subtree: true })
    // 在元素上记录，避免重复注册
    root.__imgRewriteObserver = obs
    log.debug('已为预览区域注册 MutationObserver，用于图片自动重写')
  } catch {}
}

// 读取粘贴设置（带防御与中文日志）
async function loadPasteCfg() {
  try {
    const d = await window.api?.settingsGet?.('pasteImage.assetsDir')
    const s = await window.api?.settingsGet?.('pasteImage.subdirByDate')
    const n = await window.api?.settingsGet?.('pasteImage.naming')
    const nn = await window.api?.settingsGet?.('pasteImage.nearNoteAssets')
    if (d?.ok && d.value) pasteCfg.assetsDir = String(d.value)
    if (s?.ok && typeof s.value === 'boolean') pasteCfg.subdirByDate = s.value
    if (n?.ok && (n.value === 'timestamp' || n.value === 'original')) pasteCfg.naming = n.value
    if (nn?.ok && typeof nn.value === 'boolean') pasteCfg.nearNoteAssets = nn.value
    await log.debug('图片粘贴设置已加载：', JSON.stringify(pasteCfg))
  } catch (e) {
    await log.warn('读取图片粘贴设置失败，使用默认：', String(e?.message || e))
  }
}

// （已移除 Vditor 的 i18n 相关兜底逻辑）

const initError = ref('')
const ready = ref(false)
// 根容器 ref，用于挂载预览图片观察器
const rootEl = ref(null)

// 外部可调用方法：设置/获取值、聚焦、设置选择区
const setValue = (v) => {
  innerValue.value = String(v ?? '')
}
const getValue = () => String(innerValue.value || '')
const focus = () => {}
// 设置选择区（基于字符偏移量）
const setSelection = (_s, _e) => {}

defineExpose({ setValue, getValue, focus, setSelection })

// 监听外部 v-model 变化，同步到内部值（已在下方单独处理）

// ByteMD 维护的内部值
const innerValue = ref(String(props.modelValue || ''))
// 用于强制重建编辑器实例（例如切换文件时）
const editorKey = ref(0)
watch(
  () => props.modelValue,
  (v) => {
    const nv = String(v ?? '')
    if (nv !== innerValue.value) {
      innerValue.value = nv
      try { log.debug('检测到外部内容变化，已同步到编辑器内容') } catch {}
    }
  }
)
// 监听当前文件路径变化，强制刷新编辑器（避免第三方组件缓存导致不更新）
watch(
  () => props.currentFilePath,
  () => {
    try { log.debug('检测到当前文件切换，强制刷新编辑器实例') } catch {}
    editorKey.value++
  }
)
function onEditorChange(v) {
  try {
    innerValue.value = String(v ?? '')
    emit('update:modelValue', innerValue.value)
    emit('change', innerValue.value)
  } catch {}
}

// ByteMD 图片上传钩子：将图片写入 Vault 并返回链接
// ByteMD 期望返回形如：[{ url, alt, title }]
async function handleUploadImages(files) {
  try {
    const list = Array.from(files || []).filter(
      (f) => f && (f.type?.startsWith?.('image/') || f.name)
    )
    if (!list.length) return
    await log.info('检测到图片上传（ByteMD），数量：', list.length)
    const now = new Date()
    const yyyy = String(now.getFullYear())
    const mm = String(now.getMonth() + 1).padStart(2, '0')
    // 目录选择
    let baseDirRaw = ''
    if (pasteCfg.nearNoteAssets && props.currentFilePath) {
      const p = String(props.currentFilePath)
        .replace(/\\+/g, '/')
        .replace(/^\/+|\/+$/g, '')
      const idx = p.lastIndexOf('/')
      const parent = idx >= 0 ? p.slice(0, idx) : ''
      baseDirRaw = parent ? `${parent}/assets` : 'assets'
      await log.debug('使用就近保存目录（同级 assets/）：', baseDirRaw)
    } else {
      const dirFromCfg = String(pasteCfg.assetsDir || '').trim()
      baseDirRaw = dirFromCfg || String(props.assetsDir || 'assets/images')
    }
    const baseDir = baseDirRaw.replace(/\\+/g, '/').replace(/^\/+|\/+$/g, '')
    const subdir = pasteCfg.subdirByDate ? `${baseDir}/${yyyy}/${mm}` : baseDir

    const toBase64 = (blob) =>
      new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => {
          try {
            const res = String(reader.result || '')
            const idx = res.indexOf(',')
            resolve(idx >= 0 ? res.slice(idx + 1) : res)
          } catch (e) {
            reject(e)
          }
        }
        reader.onerror = reject
        reader.readAsDataURL(blob)
      })

    const results = []
    for (const file of list) {
      const ext = (file.name?.split?.('.')?.pop?.() || 'png').toLowerCase()
      const ts = now.getTime()
      const rand = Math.random().toString(36).slice(2, 8)
      const safeBase = (file.name || 'pasted').replace(/[^\w\-\.]+/g, '_').replace(/\.+$/, '')
      const name =
        pasteCfg.naming === 'original' ? `${safeBase}_${ts}.${ext}` : `img_${ts}_${rand}.${ext}`
      const relPath = `${subdir}/${name}`

      let b64 = ''
      try {
        b64 = await toBase64(file)
      } catch (e) {
        await log.error('图片转 base64 失败：', file.name, String(e?.message || e))
        continue
      }
      try {
        const r = await window.api.fsWriteFile({
          relativePath: relPath,
          content: b64,
          encoding: 'base64'
        })
        if (!r?.ok) throw new Error(r?.reason || '写入失败')
        await log.info('图片已保存：', relPath)
      } catch (e) {
        await log.error('保存图片失败：', relPath, String(e?.message || e))
        continue
      }
      // 返回相对链接给 ByteMD，用于插入
      const link = encodeURI(relPath)
      results.push({ url: link, alt: file.name, title: file.name })
    }
    return results
  } catch (e) {
    await log.error('处理图片上传失败（ByteMD）：', String(e?.message || e))
  }
}

onMounted(async () => {
  await log.info('初始化 ByteMD 编辑器')
  // 预加载一次粘贴设置，并监听应用配置变化
  await loadPasteCfg()
  cfgChangedHandler = () => {
    loadPasteCfg()
  }
  window.addEventListener?.('app:configChanged', cfgChangedHandler)
  try {
    /* @ts-ignore */ window.mermaid = mermaid
  } catch {}
  ready.value = true
  await log.info('ByteMD 已就绪')
  // 等待渲染完成后为预览区挂观察器，并尝试重写图片
  await nextTick()
  try {
    if (rootEl.value) {
      setupPreviewObserver(rootEl.value)
      await rewritePreviewImages(rootEl.value)
      await rewritePreviewMedia(rootEl.value)
    }
  } catch {}
})

onBeforeUnmount(() => {
  // 释放预览中创建的对象 URL，避免内存泄漏
  revokeAllMediaObjectUrls()
})
</script>

<template>
  <div class="w-full editor-root" :class="themeClass" ref="rootEl">
    <div v-if="initError" class="mb-2 text-xs text-red-600">编辑器初始化失败：{{ initError }}</div>
    <Editor
      :key="editorKey"
      :value="innerValue"
      :plugins="plugins"
      :locale="zhCN"
      :uploadImages="handleUploadImages"
      :editable="!readonly"
      @change="onEditorChange"
      class="border rounded-md"
      style="height: 100%; min-height: 0; --bytemd-height: 100%"
    />
  </div>
</template>

<style scoped>
/* 让组件占满父容器可用高度（由父容器控制具体高度） */
.editor-root {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0; /* 关键：允许内部滚动 */
}
/* ByteMD 外层容器默认高度由内联样式控制，这里配合 100% 高度使用 */
/* 深度穿透：让 ByteMD 整体和主体区占满高度，状态栏贴底 */
.editor-root :deep(.bytemd) {
  display: flex;
  flex-direction: column;
  height: 100%;
}
.editor-root :deep(.bytemd-body) {
  flex: 1 1 auto;
  min-height: 0;
}
/* 全屏模式：根据 App 注入的 --app-header-height 动态预留顶部空间 */
.editor-root :deep(.bytemd-fullscreen),
.editor-root :deep(.bytemd.bytemd-fullscreen) {
  top: var(--app-header-height, 44px) !important;
  height: calc(100vh - var(--app-header-height, 44px)) !important;
}
/* 预览区防横向溢出：长链接/单词换行，图片不超宽，代码块内部横向滚动（所有主题通用） */
.editor-root :deep(.bytemd-preview) {
  overflow-wrap: anywhere;
  word-break: break-word;
}
.editor-root :deep(.bytemd-preview img) {
  max-width: 100%;
  height: auto;
}
.editor-root :deep(.bytemd-preview pre) {
  overflow-x: auto;
}
/* ========== 主题：GitHub（默认） ========== */
.editor-root.theme-github :deep(.bytemd-preview) {
  color: #24292f;
  line-height: 1.7;
  font-size: 14px;
}
.editor-root.theme-github :deep(.bytemd-preview h1),
.editor-root.theme-github :deep(.bytemd-preview h2),
.editor-root.theme-github :deep(.bytemd-preview h3),
.editor-root.theme-github :deep(.bytemd-preview h4),
.editor-root.theme-github :deep(.bytemd-preview h5),
.editor-root.theme-github :deep(.bytemd-preview h6) {
  color: #111827;
  font-weight: 600;
  line-height: 1.3;
  margin-top: 1.2em;
  margin-bottom: .5em;
}
.editor-root.theme-github :deep(.bytemd-preview h1) { font-size: 1.8em; border-bottom: 1px solid #e5e7eb; padding-bottom: .3em; }
.editor-root.theme-github :deep(.bytemd-preview h2) { font-size: 1.5em; border-bottom: 1px solid #e5e7eb; padding-bottom: .2em; }
.editor-root.theme-github :deep(.bytemd-preview h3) { font-size: 1.25em; }
.editor-root.theme-github :deep(.bytemd-preview a) { color: #0969da; text-decoration: none; }
.editor-root.theme-github :deep(.bytemd-preview a:hover) { text-decoration: underline; }
.editor-root.theme-github :deep(.bytemd-preview p),
.editor-root.theme-github :deep(.bytemd-preview ul),
.editor-root.theme-github :deep(.bytemd-preview ol),
.editor-root.theme-github :deep(.bytemd-preview pre),
.editor-root.theme-github :deep(.bytemd-preview table),
.editor-root.theme-github :deep(.bytemd-preview blockquote) {
  margin: .6em 0;
}
.editor-root.theme-github :deep(.bytemd-preview code) {
  background: #f6f8fa;
  border: 1px solid #e5e7eb;
  border-radius: 4px;
  padding: .1em .3em;
  font-size: .95em;
}
.editor-root.theme-github :deep(.bytemd-preview pre code) {
  background: transparent;
  border: 0;
  padding: 0;
}
.editor-root.theme-github :deep(.bytemd-preview pre) {
  background: #0f172a;
  color: #e5e7eb;
  border-radius: 6px;
  padding: 12px;
}
.editor-root.theme-github :deep(.bytemd-preview blockquote) {
  border-left: 4px solid #d0d7de;
  background: #f6f8fa;
  color: #4b5563;
  margin: .8em 0;
  padding: .6em 1em;
}
.editor-root.theme-github :deep(.bytemd-preview hr) {
  border: 0;
  border-top: 1px solid #e5e7eb;
  margin: 1em 0;
}
.editor-root.theme-github :deep(.bytemd-preview ul) { padding-left: 1.4em; }
.editor-root.theme-github :deep(.bytemd-preview ol) { padding-left: 1.6em; }
.editor-root.theme-github :deep(.bytemd-preview table) {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
}
.editor-root.theme-github :deep(.bytemd-preview th),
.editor-root.theme-github :deep(.bytemd-preview td) {
  border: 1px solid #e5e7eb;
  padding: 6px 8px;
  vertical-align: top;
  word-break: break-word;
}

/* ========== 主题：Dark ========== */
.editor-root.theme-dark :deep(.bytemd-preview) {
  color: #e5e7eb;
  line-height: 1.7;
  font-size: 14px;
  background: transparent;
}
.editor-root.theme-dark :deep(.bytemd-preview a) { color: #60a5fa; }
.editor-root.theme-dark :deep(.bytemd-preview h1),
.editor-root.theme-dark :deep(.bytemd-preview h2),
.editor-root.theme-dark :deep(.bytemd-preview h3),
.editor-root.theme-dark :deep(.bytemd-preview h4),
.editor-root.theme-dark :deep(.bytemd-preview h5),
.editor-root.theme-dark :deep(.bytemd-preview h6) {
  color: #f3f4f6;
  margin-top: 1.1em;
  margin-bottom: .5em;
}
.editor-root.theme-dark :deep(.bytemd-preview pre) {
  background: #111827;
  color: #e5e7eb;
  border-radius: 6px;
  padding: 12px;
}
.editor-root.theme-dark :deep(.bytemd-preview code) {
  background: #1f2937;
  border: 1px solid #374151;
  border-radius: 4px;
  padding: .1em .3em;
}
.editor-root.theme-dark :deep(.bytemd-preview blockquote) {
  border-left: 4px solid #374151;
  background: #0b1220;
  color: #cbd5e1;
  padding: .6em 1em;
}
.editor-root.theme-dark :deep(.bytemd-preview hr) { border: 0; border-top: 1px solid #374151; }
.editor-root.theme-dark :deep(.bytemd-preview table) { width: 100%; border-collapse: collapse; table-layout: fixed; }
.editor-root.theme-dark :deep(.bytemd-preview th),
.editor-root.theme-dark :deep(.bytemd-preview td) { border: 1px solid #374151; padding: 6px 8px; }

/* Highlight.js（按主题覆盖）*/
.editor-root.theme-dark :deep(.bytemd-preview pre code.hljs) {
  display: block;
  background: #0d1117;
  color: #c9d1d9;
}
.editor-root.theme-dark :deep(.hljs-keyword),
.editor-root.theme-dark :deep(.hljs-selector-tag),
.editor-root.theme-dark :deep(.hljs-literal) { color: #ff7b72; }
.editor-root.theme-dark :deep(.hljs-string),
.editor-root.theme-dark :deep(.hljs-number) { color: #a5d6ff; }
.editor-root.theme-dark :deep(.hljs-title),
.editor-root.theme-dark :deep(.hljs-name),
.editor-root.theme-dark :deep(.hljs-attr) { color: #d2a8ff; }
.editor-root.theme-dark :deep(.hljs-comment) { color: #8b949e; }
.editor-root.theme-dark :deep(.hljs-attribute) { color: #79c0ff; }

/* ========== 主题：Classic（衬线/文艺风） ========== */
.editor-root.theme-classic :deep(.bytemd-preview) {
  color: #2b2b2b;
  line-height: 1.8;
  font-size: 15px;
  font-family: Georgia, 'Times New Roman', serif;
}
.editor-root.theme-classic :deep(.bytemd-preview h1) { font-size: 2em; border-bottom: 1px solid #e5e7eb; padding-bottom: .3em; }
.editor-root.theme-classic :deep(.bytemd-preview h2) { font-size: 1.6em; }
.editor-root.theme-classic :deep(.bytemd-preview h3) { font-size: 1.3em; }
.editor-root.theme-classic :deep(.bytemd-preview a) { color: #7c3aed; text-decoration: underline; }
.editor-root.theme-classic :deep(.bytemd-preview blockquote) {
  border-left: 4px solid #c4b5fd;
  background: #f5f3ff;
  color: #4b5563;
  padding: .6em 1em;
}
.editor-root.theme-classic :deep(.bytemd-preview pre) { background: #111827; color: #e5e7eb; border-radius: 6px; padding: 12px; }
.editor-root.theme-classic :deep(.bytemd-preview code) { background: #f3f4f6; border: 1px solid #e5e7eb; border-radius: 4px; padding: .1em .3em; }
.editor-root.theme-classic :deep(.bytemd-preview table) { width: 100%; border-collapse: collapse; table-layout: fixed; }
.editor-root.theme-classic :deep(.bytemd-preview th),
.editor-root.theme-classic :deep(.bytemd-preview td) { border: 1px solid #e5e7eb; padding: 6px 8px; }

/* Highlight.js（按主题覆盖）*/
.editor-root.theme-classic :deep(.bytemd-preview pre code.hljs) {
  display: block;
  background: #f7f8fa;
  color: #374151;
}
.editor-root.theme-classic :deep(.hljs-keyword),
.editor-root.theme-classic :deep(.hljs-selector-tag),
.editor-root.theme-classic :deep(.hljs-literal) { color: #b91c1c; }
.editor-root.theme-classic :deep(.hljs-string),
.editor-root.theme-classic :deep(.hljs-number) { color: #065f46; }
.editor-root.theme-classic :deep(.hljs-title),
.editor-root.theme-classic :deep(.hljs-name),
.editor-root.theme-classic :deep(.hljs-attr) { color: #1d4ed8; }
.editor-root.theme-classic :deep(.hljs-comment) { color: #6b7280; }
.editor-root.theme-classic :deep(.hljs-attribute) { color: #7c3aed; }

/* ========== 主题：Solarized（浅色） ========== */
.editor-root.theme-solarized :deep(.bytemd-preview) {
  color: #586e75;
  line-height: 1.7;
  font-size: 14px;
  background: transparent;
}
.editor-root.theme-solarized :deep(.bytemd-preview a) { color: #268bd2; }
.editor-root.theme-solarized :deep(.bytemd-preview h1),
.editor-root.theme-solarized :deep(.bytemd-preview h2),
.editor-root.theme-solarized :deep(.bytemd-preview h3),
.editor-root.theme-solarized :deep(.bytemd-preview h4),
.editor-root.theme-solarized :deep(.bytemd-preview h5),
.editor-root.theme-solarized :deep(.bytemd-preview h6) {
  color: #073642;
  margin-top: 1.1em;
  margin-bottom: .5em;
}
.editor-root.theme-solarized :deep(.bytemd-preview pre) {
  background: #002b36;
  color: #eee8d5;
  border-radius: 6px;
  padding: 12px;
}
.editor-root.theme-solarized :deep(.bytemd-preview code) {
  background: #fdf6e3;
  border: 1px solid #eee8d5;
  border-radius: 4px;
  padding: .1em .3em;
}
.editor-root.theme-solarized :deep(.bytemd-preview blockquote) {
  border-left: 4px solid #eee8d5;
  background: #fdf6e3;
  color: #657b83;
  padding: .6em 1em;
}
.editor-root.theme-solarized :deep(.bytemd-preview hr) { border: 0; border-top: 1px solid #eee8d5; }
.editor-root.theme-solarized :deep(.bytemd-preview table) { width: 100%; border-collapse: collapse; table-layout: fixed; }
.editor-root.theme-solarized :deep(.bytemd-preview th),
.editor-root.theme-solarized :deep(.bytemd-preview td) { border: 1px solid #eee8d5; padding: 6px 8px; }

/* Highlight.js（按主题覆盖）*/
.editor-root.theme-solarized :deep(.bytemd-preview pre code.hljs) {
  display: block;
  background: #fdf6e3;
  color: #657b83;
}
.editor-root.theme-solarized :deep(.hljs-keyword),
.editor-root.theme-solarized :deep(.hljs-selector-tag),
.editor-root.theme-solarized :deep(.hljs-literal) { color: #b58900; }
.editor-root.theme-solarized :deep(.hljs-string),
.editor-root.theme-solarized :deep(.hljs-number) { color: #2aa198; }
.editor-root.theme-solarized :deep(.hljs-title),
.editor-root.theme-solarized :deep(.hljs-name),
.editor-root.theme-solarized :deep(.hljs-attr) { color: #268bd2; }
.editor-root.theme-solarized :deep(.hljs-comment) { color: #93a1a1; }
.editor-root.theme-solarized :deep(.hljs-attribute) { color: #6c71c4; }

/* ========== 主题：Sepia（护眼） ========== */
.editor-root.theme-sepia :deep(.bytemd-preview) {
  color: #5b4636;
  line-height: 1.8;
  font-size: 15px;
  background: transparent;
}
.editor-root.theme-sepia :deep(.bytemd-preview a) { color: #8b5e34; }
.editor-root.theme-sepia :deep(.bytemd-preview h1),
.editor-root.theme-sepia :deep(.bytemd-preview h2),
.editor-root.theme-sepia :deep(.bytemd-preview h3),
.editor-root.theme-sepia :deep(.bytemd-preview h4),
.editor-root.theme-sepia :deep(.bytemd-preview h5),
.editor-root.theme-sepia :deep(.bytemd-preview h6) {
  color: #4a3728;
  margin-top: 1.1em;
  margin-bottom: .5em;
}
.editor-root.theme-sepia :deep(.bytemd-preview pre) {
  background: #3f2d22;
  color: #f3e9dc;
  border-radius: 6px;
  padding: 12px;
}
.editor-root.theme-sepia :deep(.bytemd-preview code) {
  background: #f4e9d8;
  border: 1px solid #ead9bf;
  border-radius: 4px;
  padding: .1em .3em;
}
.editor-root.theme-sepia :deep(.bytemd-preview blockquote) {
  border-left: 4px solid #ead9bf;
  background: #fbf6ee;
  color: #6b4f3a;
  padding: .6em 1em;
}
.editor-root.theme-sepia :deep(.bytemd-preview hr) { border: 0; border-top: 1px solid #ead9bf; }
.editor-root.theme-sepia :deep(.bytemd-preview table) { width: 100%; border-collapse: collapse; table-layout: fixed; }
.editor-root.theme-sepia :deep(.bytemd-preview th),
.editor-root.theme-sepia :deep(.bytemd-preview td) { border: 1px solid #ead9bf; padding: 6px 8px; }

/* Highlight.js（按主题覆盖）*/
.editor-root.theme-sepia :deep(.bytemd-preview pre code.hljs) {
  display: block;
  background: #3f2d22;
  color: #f3e9dc;
}
.editor-root.theme-sepia :deep(.hljs-keyword),
.editor-root.theme-sepia :deep(.hljs-selector-tag),
.editor-root.theme-sepia :deep(.hljs-literal) { color: #ffd580; }
.editor-root.theme-sepia :deep(.hljs-string),
.editor-root.theme-sepia :deep(.hljs-number) { color: #c1e1a6; }
.editor-root.theme-sepia :deep(.hljs-title),
.editor-root.theme-sepia :deep(.hljs-name),
.editor-root.theme-sepia :deep(.hljs-attr) { color: #f7c5a0; }
.editor-root.theme-sepia :deep(.hljs-comment) { color: #e6d5c3; }
.editor-root.theme-sepia :deep(.hljs-attribute) { color: #f0a6ca; }

/* ========== 主题：Nord ========== */
.editor-root.theme-nord :deep(.bytemd-preview) {
  color: #2e3440;
  line-height: 1.7;
  font-size: 14px;
}
.editor-root.theme-nord :deep(.bytemd-preview a) { color: #5e81ac; }
.editor-root.theme-nord :deep(.bytemd-preview h1),
.editor-root.theme-nord :deep(.bytemd-preview h2),
.editor-root.theme-nord :deep(.bytemd-preview h3),
.editor-root.theme-nord :deep(.bytemd-preview h4),
.editor-root.theme-nord :deep(.bytemd-preview h5),
.editor-root.theme-nord :deep(.bytemd-preview h6) {
  color: #2e3440;
  margin-top: 1.2em;
  margin-bottom: .5em;
}
.editor-root.theme-nord :deep(.bytemd-preview pre) {
  background: #2e3440;
  color: #e5e9f0;
  border-radius: 6px;
  padding: 12px;
}
.editor-root.theme-nord :deep(.bytemd-preview code) {
  background: #eceff4;
  border: 1px solid #d8dee9;
  border-radius: 4px;
  padding: .1em .3em;
}
.editor-root.theme-nord :deep(.bytemd-preview blockquote) {
  border-left: 4px solid #d8dee9;
  background: #eceff4;
  color: #4c566a;
  padding: .6em 1em;
}
.editor-root.theme-nord :deep(.bytemd-preview hr) { border: 0; border-top: 1px solid #d8dee9; }
.editor-root.theme-nord :deep(.bytemd-preview table) { width: 100%; border-collapse: collapse; table-layout: fixed; }
.editor-root.theme-nord :deep(.bytemd-preview th),
.editor-root.theme-nord :deep(.bytemd-preview td) { border: 1px solid #d8dee9; padding: 6px 8px; }

/* Highlight.js（按主题覆盖）*/
.editor-root.theme-nord :deep(.bytemd-preview pre code.hljs) {
  display: block;
  background: #2e3440;
  color: #eceff4;
}
.editor-root.theme-nord :deep(.hljs-keyword),
.editor-root.theme-nord :deep(.hljs-selector-tag),
.editor-root.theme-nord :deep(.hljs-literal) { color: #bf616a; }
.editor-root.theme-nord :deep(.hljs-string),
.editor-root.theme-nord :deep(.hljs-number) { color: #a3be8c; }
.editor-root.theme-nord :deep(.hljs-title),
.editor-root.theme-nord :deep(.hljs-name),
.editor-root.theme-nord :deep(.hljs-attr) { color: #88c0d0; }
.editor-root.theme-nord :deep(.hljs-comment) { color: #81a1c1; }
.editor-root.theme-nord :deep(.hljs-attribute) { color: #b48ead; }

/* ========== 主题：CtBB（应用主色适配） ========== */
.editor-root.theme-ctbb :deep(.bytemd-preview) {
  color: #071427; /* 深海蓝文字 */
  line-height: 1.75;
  font-size: 14px;
  /* 背景用微妙的蓝青渐变，保持低噪点但有层次 */
  background: radial-gradient(1200px 600px at 10% 0%, rgba(14, 165, 233, 0.06), transparent 60%),
              radial-gradient(900px 500px at 90% 10%, rgba(13, 148, 136, 0.06), transparent 55%);
}
/* 标题：蓝-青-天蓝 渐变字 + 底部分隔线发光 */
.editor-root.theme-ctbb :deep(.bytemd-preview h1),
.editor-root.theme-ctbb :deep(.bytemd-preview h2),
.editor-root.theme-ctbb :deep(.bytemd-preview h3),
.editor-root.theme-ctbb :deep(.bytemd-preview h4),
.editor-root.theme-ctbb :deep(.bytemd-preview h5),
.editor-root.theme-ctbb :deep(.bytemd-preview h6) {
  margin-top: 1.15em;
  margin-bottom: .55em;
  background: linear-gradient(90deg, #60a5fa, #22d3ee 55%, #7dd3fc);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.editor-root.theme-ctbb :deep(.bytemd-preview h1),
.editor-root.theme-ctbb :deep(.bytemd-preview h2) {
  position: relative;
}
.editor-root.theme-ctbb :deep(.bytemd-preview h1::after),
.editor-root.theme-ctbb :deep(.bytemd-preview h2::after) {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: -6px;
  height: 2px;
  background: linear-gradient(90deg, rgba(14,165,233,.85), rgba(59,130,246,.85));
  box-shadow: 0 0 8px rgba(14,165,233,.5);
}
/* 链接：霓虹下划线与悬浮发光 */
.editor-root.theme-ctbb :deep(.bytemd-preview a) {
  color: #0284c7;
  text-decoration: none;
  border-bottom: 1px dashed rgba(14,165,233,.6);
  transition: color .15s ease, box-shadow .15s ease, border-color .15s ease;
}
.editor-root.theme-ctbb :deep(.bytemd-preview a:hover) {
  color: #06b6d4;
  border-bottom-color: rgba(56,189,248,.9);
  box-shadow: 0 2px 0 rgba(56,189,248,.5);
}
/* 行内代码：青色描边与轻微发光 */
.editor-root.theme-ctbb :deep(.bytemd-preview code) {
  background: rgba(2,132,199,.08);
  border: 1px solid rgba(14,165,233,.35);
  color: #0b1324;
  border-radius: 6px;
  padding: .15em .4em;
  box-shadow: inset 0 0 0.5px rgba(14,165,233,.35), 0 0 2px rgba(14,165,233,.1);
}
/* 代码块：深蓝渐变背景 + 渐变边框 + 霓虹投影 */
.editor-root.theme-ctbb :deep(.bytemd-preview pre) {
  background: linear-gradient(180deg, #0a1020, #0b1220);
  color: #e6f1ff;
  border-radius: 10px;
  padding: 14px 14px;
  border: 1px solid rgba(56,189,248,.2);
  box-shadow: 0 6px 18px rgba(2,132,199,.15), inset 0 0 0 1px rgba(14,165,233,.12);
}
/* 引用：左侧多彩渐变条 + 淡青底 + 字色偏青 */
.editor-root.theme-ctbb :deep(.bytemd-preview blockquote) {
  border-left: 6px solid transparent;
  background: linear-gradient(180deg, rgba(125,211,252,.15), rgba(34,211,238,.08));
  color: #0e7490;
  padding: .65em 1em;
  position: relative;
}
.editor-root.theme-ctbb :deep(.bytemd-preview blockquote::before) {
  content: '';
  position: absolute;
  left: 0; top: 0; bottom: 0; width: 6px;
  background: linear-gradient(180deg, #60a5fa, #22d3ee 70%, #7dd3fc);
  box-shadow: 0 0 8px rgba(56,189,248,.3);
}
/* 列表与任务列表的小圆点/复选框提亮 */
.editor-root.theme-ctbb :deep(.bytemd-preview li) { margin: .35em 0; }
.editor-root.theme-ctbb :deep(.bytemd-preview input[type='checkbox']) {
  accent-color: #22d3ee;
  width: 14px; height: 14px;
}
/* 分隔线：青蓝光带 */
.editor-root.theme-ctbb :deep(.bytemd-preview hr) {
  border: 0; height: 2px; margin: 1em 0;
  background: linear-gradient(90deg, rgba(14,165,233,.0), rgba(14,165,233,.75), rgba(59,130,246,.0));
  box-shadow: 0 0 8px rgba(56,189,248,.25);
}
/* 表格：表头蓝青渐变 + 网格微光 */
.editor-root.theme-ctbb :deep(.bytemd-preview table) {
  width: 100%; border-collapse: collapse; table-layout: fixed;
}
.editor-root.theme-ctbb :deep(.bytemd-preview th) {
  color: #0b1324;
  background: linear-gradient(180deg, rgba(125,211,252,.5), rgba(59,130,246,.25));
  border: 1px solid rgba(14,165,233,.25);
  padding: 8px;
}
.editor-root.theme-ctbb :deep(.bytemd-preview td) {
  border: 1px solid rgba(14,165,233,.2);
  padding: 8px;
}

/* Highlight.js（CtBB 按主题覆盖 - 炫彩但保持可读性）*/
.editor-root.theme-ctbb :deep(.bytemd-preview pre code.hljs) {
  display: block;
  background: transparent; /* 由 pre 控制背景 */
  color: #e6f1ff;
  text-shadow: 0 0 0.6px rgba(230,241,255,.25);
}
.editor-root.theme-ctbb :deep(.hljs-keyword),
.editor-root.theme-ctbb :deep(.hljs-selector-tag),
.editor-root.theme-ctbb :deep(.hljs-literal) { color: #7dd3fc; }
.editor-root.theme-ctbb :deep(.hljs-string),
.editor-root.theme-ctbb :deep(.hljs-number) { color: #22d3ee; }
.editor-root.theme-ctbb :deep(.hljs-title),
.editor-root.theme-ctbb :deep(.hljs-name),
.editor-root.theme-ctbb :deep(.hljs-attr) { color: #93c5fd; }
.editor-root.theme-ctbb :deep(.hljs-comment) { color: #94a3b8; }
.editor-root.theme-ctbb :deep(.hljs-attribute) { color: #60a5fa; }
</style>
