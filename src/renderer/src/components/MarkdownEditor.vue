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
  nextTick
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
// 数学公式样式（KaTeX）
import 'katex/dist/katex.min.css'
import { createLogger } from '../utils/logger'

const props = defineProps({
  modelValue: { type: String, default: '' },
  readonly: { type: Boolean, default: false },
  // 资源保存的相对目录（基于 Vault 根），例如：assets/images
  assetsDir: { type: String, default: 'assets/images' },
  // 当前笔记相对 Vault 的路径（例如：notes/foo.md），用于就近保存
  currentFilePath: { type: String, default: '' }
})
const emit = defineEmits(['update:modelValue', 'change'])

// ByteMD 插件集合
const plugins = [
  gfm(),
  math(),
  mermaidPlugin({ mermaid })
]

// 日志器（作用域：MarkdownEditor）
const log = createLogger('MarkdownEditor')

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
    }
  } catch {}
})
</script>

<template>
  <div class="w-full" ref="rootEl">
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
      style="height: 480px"
    />
  </div>
</template>

<style scoped>
/* 编辑器样式保持默认；如需个性化请告知具体项（保留中文注释规范） */
</style>
