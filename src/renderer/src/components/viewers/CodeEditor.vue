<script setup>
import { ref, onMounted, watch, defineProps, defineExpose } from 'vue'
import { ElMessage, ElButton, ElSpace } from 'element-plus'
import { EditorState, Compartment } from '@codemirror/state'
import { EditorView, keymap, highlightActiveLine } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { lineNumbers } from '@codemirror/view'
import { openSearchPanel, searchKeymap, highlightSelectionMatches } from '@codemirror/search'

const props = defineProps({
  // 基于 Vault 的相对路径
  relativePath: { type: String, required: true },
  // 只读
  readonly: { type: Boolean, default: false }
})

const container = ref(null)
let view = null
const value = ref('')
const saving = ref(false)
const dirty = ref(false)

const langConf = new Compartment()
const readOnlyConf = new Compartment()

function getExtFromPath(p) {
  const s = String(p || '').toLowerCase()
  return s.includes('.') ? s.split('.').pop() : ''
}

async function loadLanguageByExt(ext) {
  try {
    switch (ext) {
      case 'js':
        return (await import('@codemirror/lang-javascript')).javascript()
      case 'jsx':
        return (await import('@codemirror/lang-javascript')).javascript({ jsx: true })
      case 'ts':
        return (await import('@codemirror/lang-javascript')).javascript({ typescript: true })
      case 'tsx':
        return (await import('@codemirror/lang-javascript')).javascript({ jsx: true, typescript: true })
      case 'json':
        return (await import('@codemirror/lang-json')).json()
      case 'css':
      case 'less':
      case 'scss':
        return (await import('@codemirror/lang-css')).css()
      case 'html':
      case 'htm':
      case 'vue': // 简化处理
        return (await import('@codemirror/lang-html')).html()
      case 'yml':
      case 'yaml':
        return (await import('@codemirror/lang-yaml')).yaml()
      case 'toml': {
        const { StreamLanguage } = await import('@codemirror/language')
        const mod = await import('@codemirror/legacy-modes/mode/toml')
        return StreamLanguage.define(mod.toml)
      }
      case 'sql':
        return (await import('@codemirror/lang-sql')).sql()
      case 'py':
      case 'pyw':
        return (await import('@codemirror/lang-python')).python()
      case 'ini':
      case 'cfg':
      case 'conf':
      case 'properties': {
        const { StreamLanguage } = await import('@codemirror/language')
        const mod = await import('@codemirror/legacy-modes/mode/properties')
        return StreamLanguage.define(mod.properties)
      }
      default:
        return []
    }
  } catch (e) {
    // 动态导入失败时静默降级
    return []
  }
}

async function guessLanguageExt(p) {
  const ext = getExtFromPath(p)
  return await loadLanguageByExt(ext)
}

function buildExtensions() {
  return [
    lineNumbers(),
    highlightActiveLine(),
    history(),
    // 本地化 CodeMirror 搜索面板的文案
    EditorState.phrases.of({
      'Find': '查找',
      'Replace': '替换',
      'Replace all': '全部替换',
      'match case': '区分大小写',
      'regexp': '正则',
      'by word': '整词匹配',
      'close': '关闭',
    }),
    highlightSelectionMatches(),
    keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
    readOnlyConf.of(EditorState.readOnly.of(!!props.readonly)),
    // 先占位，待实际语言加载后通过 reconfigure 应用
    langConf.of([])
  ]
}

async function loadFile() {
  try {
    const rel = String(props.relativePath || '').replace(/^\/+|^\\+/, '')
    const r = await window.api?.fsReadFile?.({ relativePath: rel, encoding: 'utf-8' })
    if (!r?.ok) throw new Error(r?.reason || '读取失败')
    value.value = String(r.content || '')
    dirty.value = false
    if (view) {
      view.setState(EditorState.create({ doc: value.value, extensions: buildExtensions() }))
      // 重新应用语言高亮
      await applyLanguage()
    }
  } catch (e) {
    ElMessage.error('读取失败：' + String(e?.message || e))
  }
}

async function saveFile() {
  if (props.readonly) return
  if (!dirty.value) { ElMessage.success('已保存'); return }
  try {
    saving.value = true
    const rel = String(props.relativePath || '').replace(/^\/+|^\\+/, '')
    const r = await window.api?.fsWriteFile?.({ relativePath: rel, content: value.value, encoding: 'utf-8' })
    if (!r?.ok) throw new Error(r?.reason || '写入失败')
    dirty.value = false
    ElMessage.success('保存成功')
  } catch (e) {
    ElMessage.error('保存失败：' + String(e?.message || e))
  } finally {
    saving.value = false
  }
}

// 暴露给父组件：用于关闭窗口前保存。静默返回结构化结果，父组件决定是否提示。
async function saveIfDirty() {
  try {
    if (props.readonly) return { ok: true }
    if (!dirty.value) return { ok: true }
    const rel = String(props.relativePath || '').replace(/^\/+|^\\+/, '')
    const r = await window.api?.fsWriteFile?.({ relativePath: rel, content: value.value, encoding: 'utf-8' })
    if (!r?.ok) return { ok: false, reason: String(r?.reason || '写入失败') }
    dirty.value = false
    return { ok: true }
  } catch (e) {
    return { ok: false, reason: String(e?.message || e) }
  }
}

defineExpose({ saveIfDirty })

async function applyLanguage() {
  try {
    const langExt = await guessLanguageExt(props.relativePath)
    if (view) {
      view.dispatch({ effects: langConf.reconfigure(langExt) })
    }
  } catch {}
}

function openFind() {
  if (view) openSearchPanel(view)
}

function openReplace() {
  if (view) openSearchPanel(view) // CodeMirror 搜索面板内可切换替换
}

onMounted(async () => {
  await loadFile()
  view = new EditorView({
    doc: value.value,
    extensions: [
      ...buildExtensions(),
      EditorView.updateListener.of((v) => {
        if (v.docChanged) {
          value.value = v.state.doc.toString()
          dirty.value = true
        }
      })
    ],
    parent: container.value
  })
  await applyLanguage()
})

watch(() => props.relativePath, async () => {
  await loadFile()
  await applyLanguage()
})
</script>

<template>
  <div class="code-editor-root">
    <div class="toolbar" v-if="!readonly">
      <ElSpace>
        <ElButton size="small" type="primary" :loading="saving" @click="saveFile">保存</ElButton>
        <ElButton size="small" @click="openFind">查找 (Ctrl+F)</ElButton>
        <ElButton size="small" @click="openReplace">替换 (Ctrl+H)</ElButton>
      </ElSpace>
      <span class="status" v-if="dirty">已修改</span>
      <span class="status ok" v-else>已保存</span>
    </div>
    <div ref="container" class="editor"></div>
  </div>
</template>

<style scoped>
.code-editor-root { display: flex; flex-direction: column; width: 100%; height: 100%; min-height: 0; }
.toolbar { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-bottom: 1px solid #e5e7eb; }
.status { font-size: 12px; color: #ef4444; margin-left: 8px; }
.status.ok { color: #10b981; }
.editor { flex: 1 1 auto; min-height: 0; }
:deep(.cm-editor) { height: 100%; }
:deep(.cm-scroller) { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace; font-size: 13px; }
</style>
