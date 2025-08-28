<script setup>
import { computed, toRefs, ref, watch, defineExpose } from 'vue'
import { getFileKind } from '../fileTypes.js'
import MarkdownEditor from './MarkdownEditor.vue'
import ImageViewer from './viewers/ImageViewer.vue'
import PdfViewer from './viewers/PdfViewer.vue'
import HtmlViewer from './viewers/HtmlViewer.vue'
import CodeEditor from './viewers/CodeEditor.vue'
import AudioViewer from './viewers/AudioViewer.vue'
import VideoViewer from './viewers/VideoViewer.vue'
import OfficeViewer from './viewers/OfficeViewer.vue'
import UnsupportedViewer from './viewers/UnsupportedViewer.vue'
import { ElButton, ElSpace, ElMessage } from 'element-plus'

const props = defineProps({
  // 基于 Vault 的相对路径
  relativePath: { type: String, required: true },
  // Markdown 编辑器：v-model 代理
  editorText: { type: String, default: '' },
  // Markdown 主题
  markdownTheme: { type: String, default: 'github' },
  // 文本/代码编辑器是否只读
  readonly: { type: Boolean, default: false }
})

const emit = defineEmits(['update:editorText', 'markdownReloaded'])

const { relativePath } = toRefs(props)
const currentKind = computed(() => (relativePath.value ? getFileKind(relativePath.value) : 'unsupported'))

// 内部同步一个值以承接 MarkdownEditor 的 v-model
const innerText = ref(props.editorText)
watch(() => props.editorText, (v) => { innerText.value = v })
watch(innerText, (v) => emit('update:editorText', v))

// 重新加载：
// - Markdown：直接从磁盘重读并上抛内容，保证编辑区与文件同步
// - 其他类型：通过改变 key 强制重建（刷新媒体/iframe/CodeEditor 将在 onMounted 读文件）
const reloadKey = ref(0)
async function reloadViewer() {
  try {
    if (currentKind.value === 'markdown') {
      const rel = String(relativePath.value || '').replace(/^\/+|^\\+/, '')
      if (!rel) return
      const r = await window.api?.fsReadFile?.({ relativePath: rel, encoding: 'utf-8' })
      if (r?.ok) {
        const content = String(r.content || '')
        innerText.value = content
        emit('update:editorText', content)
        emit('markdownReloaded', content)
        return
      }
    }
  } catch {}
  // 默认回退：通过 key 触发子组件重建
  reloadKey.value++
}

// HTML 文件预览/编辑模式
const htmlMode = ref('preview') // 'preview' | 'edit'
watch(currentKind, (k) => { if (k !== 'html') htmlMode.value = 'preview' })
watch(relativePath, () => { htmlMode.value = 'preview' })
function setHtmlMode(mode) {
  const prev = htmlMode.value
  htmlMode.value = mode
  // 编辑 -> 预览 时刷新以载入最新内容
  if (prev === 'edit' && mode === 'preview') reloadViewer()
}

// HTML 预览脚本开关（默认关闭，安全优先）
const allowHtmlScripts = ref(false)
watch(currentKind, (k) => { if (k !== 'html') allowHtmlScripts.value = false })
watch(relativePath, () => { allowHtmlScripts.value = false })
function toggleAllowHtmlScripts() {
  allowHtmlScripts.value = !allowHtmlScripts.value
  // 变更 sandbox 需重载 iframe 才能生效
  if (htmlMode.value === 'preview') reloadViewer()
}

// 引用 CodeEditor 实例（文本/代码、以及 HTML 编辑模式下）
const codeEditorRef = ref(null)
const codeEditorHtmlRef = ref(null)

// 暴露给父组件：关闭窗口前保存非 Markdown（文本/代码、或 HTML 编辑模式）
async function saveIfDirtyForQuit() {
  try {
    const kind = currentKind.value
    if (kind === 'text') {
      const r = await codeEditorRef.value?.saveIfDirty?.()
      if (r && r.ok === false) return { ok: false, reason: r.reason }
      return { ok: true }
    }
    if (kind === 'html' && htmlMode.value === 'edit') {
      const r = await codeEditorHtmlRef.value?.saveIfDirty?.()
      if (r && r.ok === false) return { ok: false, reason: r.reason }
      return { ok: true }
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, reason: String(e?.message || e) }
  }
}

defineExpose({ saveIfDirtyForQuit })

// 在系统中打开当前文件
async function openInSystem() {
  try {
    const rel = String(relativePath.value || '').replace(/^\/+|^\\+/, '')
    const r = await window.api?.fsOpenPath?.({ relativePath: rel })
    if (!r?.ok) throw new Error(r?.reason || '打开失败')
  } catch (e) {
    ElMessage.error('系统打开失败：' + String(e?.message || e))
  }
}
</script>

<template>
  <div class="file-viewer-root">
    <div class="fv-toolbar">
      <ElSpace>
        <ElButton size="small" @click="openInSystem">在系统中打开</ElButton>
        <ElButton size="small" @click="reloadViewer">重新加载</ElButton>
        <!-- HTML 文件：模式切换 -->
        <template v-if="currentKind === 'html'">
          <ElButton size="small" :type="htmlMode === 'preview' ? 'primary' : 'default'" @click="setHtmlMode('preview')">预览</ElButton>
          <ElButton size="small" :type="htmlMode === 'edit' ? 'primary' : 'default'" @click="setHtmlMode('edit')">编辑</ElButton>
          <ElButton size="small" :type="allowHtmlScripts ? 'danger' : 'default'" @click="toggleAllowHtmlScripts">
            {{ allowHtmlScripts ? '禁用脚本' : '允许脚本' }}
          </ElButton>
        </template>
      </ElSpace>
    </div>
    <!-- Markdown 可编辑 -->
    <MarkdownEditor
      v-if="currentKind === 'markdown'"
      :key="'md-' + reloadKey"
      v-model="innerText"
      :currentFilePath="relativePath"
      :theme="markdownTheme"
      class="editor-flex"
    />

    <!-- 图片预览 -->
    <ImageViewer v-else-if="currentKind === 'image'" :key="'img-' + reloadKey" :relativePath="relativePath" />

    <!-- PDF 预览 -->
    <PdfViewer v-else-if="currentKind === 'pdf'" :key="'pdf-' + reloadKey" :relativePath="relativePath" />

    <!-- HTML：根据模式显示 预览/编辑 -->
    <template v-else-if="currentKind === 'html'">
      <HtmlViewer v-if="htmlMode === 'preview'" :key="'htmlpv-' + reloadKey" :relativePath="relativePath" :allowScripts="allowHtmlScripts" />
      <CodeEditor ref="codeEditorHtmlRef" v-else :key="'htmled-' + reloadKey" :relativePath="relativePath" :readonly="false" />
    </template>

    <!-- 文本/代码编辑（CodeMirror） -->
    <CodeEditor ref="codeEditorRef" v-else-if="currentKind === 'text'" :key="'txt-' + reloadKey" :relativePath="relativePath" :readonly="readonly" />

    <!-- 音频预览 -->
    <AudioViewer v-else-if="currentKind === 'audio'" :key="'aud-' + reloadKey" :relativePath="relativePath" />

    <!-- 视频预览 -->
    <VideoViewer v-else-if="currentKind === 'video'" :key="'vid-' + reloadKey" :relativePath="relativePath" />

    <!-- Office 占位 -->
    <OfficeViewer v-else-if="currentKind === 'office'" :key="'off-' + reloadKey" :relativePath="relativePath" />

    <!-- 兜底 -->
    <UnsupportedViewer v-else :key="'uns-' + reloadKey" :relativePath="relativePath" />
  </div>
</template>

<style scoped>
.file-viewer-root { width: 100%; height: 100%; min-height: 0; display: flex; flex-direction: column; }
.fv-toolbar { padding: 6px 8px; border-bottom: 1px solid #e5e7eb; }
/* 让具体编辑/预览组件占满剩余高度（MarkdownEditor 使用 editor-flex 类） */
.file-viewer-root :deep(.editor-flex) {
  display: flex;
  flex: 1 1 auto;
  min-height: 0;
}
</style>
