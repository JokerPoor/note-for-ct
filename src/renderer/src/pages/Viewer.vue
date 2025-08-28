// 接收 FileViewer 对 Markdown 的“重新加载”事件，
// 将 originalText 同步为新内容，避免被判定为未保存改动
function onMarkdownReloaded(newContent) {
  try {
    originalText.value = String(newContent ?? '')
  } catch {}
}
<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useRoute } from 'vue-router'
import FileViewer from '../components/FileViewer.vue'
import { getFileKind } from '../fileTypes.js'
import { createLogger } from '../utils/logger'
import { ElMessage } from 'element-plus'

const log = createLogger('Viewer')
const route = useRoute()

// 从 hash 路由 query 读取参数：#/viewer?path=REL&readonly=1
const rawPath = computed(() => String(route.query.path || ''))
const decodedPath = computed(() => {
  try { return decodeURIComponent(rawPath.value) } catch { return rawPath.value }
})
const relativePath = computed(() => String(decodedPath.value || '').replace(/^\/+|^\\+/, ''))
const readonly = computed(() => String(route.query.readonly || '') === '1')
const currentKind = computed(() => getFileKind(relativePath.value))

try { log.info('打开 Viewer：', { path: relativePath.value, readonly: readonly.value }) } catch {}

// Markdown v-model 挂载（仅用于 markdown 时）
const editorText = ref('')
const originalText = ref('')
// 引用子组件 FileViewer 以便调用其保存接口（用于非 Markdown）
const fileViewerRef = ref(null)

async function loadMarkdown() {
  try {
    if (currentKind.value !== 'markdown') return
    const rel = String(relativePath.value || '').replace(/^\/+|^\\+/, '')
    if (!rel) return
    const r = await window.api?.fsReadFile?.({ relativePath: rel, encoding: 'utf-8' })
    if (r?.ok) {
      editorText.value = String(r.content || '')
      originalText.value = editorText.value
    }
  } catch {}
}

// 进入页面或路径/类型变化时尝试加载 Markdown 内容
watch([relativePath, currentKind], () => { loadMarkdown() }, { immediate: true })

// 统一由 App.vue 弹窗并分发 app:saveAll，本页监听后执行保存并回执
async function saveForQuit() {
  try {
    const kind = currentKind.value
    const ro = readonly.value
    if (kind === 'markdown' && !ro && editorText.value !== originalText.value) {
      const rel = String(relativePath.value || '').replace(/^\/+|^\\+/, '')
      if (!rel) return { ok: true }
      const r = await window.api?.fsWriteFile?.({ relativePath: rel, content: String(editorText.value ?? ''), encoding: 'utf-8' })
      if (r?.ok) {
        originalText.value = String(editorText.value ?? '')
        return { ok: true }
      }
      return { ok: false, reason: String(r?.reason || '未知错误') }
    }
    if (kind !== 'markdown') {
      const r = await fileViewerRef.value?.saveIfDirtyForQuit?.()
      if (r && r.ok === false) return { ok: false, reason: r.reason }
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, reason: String(e?.message || e) }
  }
}

let onSaveAll = null
onMounted(() => {
  try { log.debug('Viewer mounted:', { path: relativePath.value }) } catch {}
  onSaveAll = async () => {
    const r = await saveForQuit()
    if (!r.ok) {
      try { ElMessage.error('保存失败：' + String(r.reason || '未知错误')) } catch {}
    }
    try { window.dispatchEvent(new CustomEvent('app:saveAll:done', { detail: { ok: !!r.ok } })) } catch {}
  }
  try { window.addEventListener('app:saveAll', onSaveAll) } catch {}
})

onBeforeUnmount(() => {
  try { window.removeEventListener('app:saveAll', onSaveAll) } catch {}
  try { log.debug('Viewer beforeUnmount:', { path: relativePath.value }) } catch {}
})
</script>

<template>
  <div class="viewer-page">
    <FileViewer
      ref="fileViewerRef"
      :relativePath="relativePath"
      v-model:editorText="editorText"
      :readonly="readonly"
      @markdownReloaded="onMarkdownReloaded"
    />
  </div>
</template>

<style scoped>
.viewer-page {
  width: 100%;
  height: 100vh; /* 独立窗口页面铺满视口高度 */
  display: flex;
  flex-direction: column;
}
</style>
