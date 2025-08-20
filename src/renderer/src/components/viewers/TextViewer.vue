<script setup>
import { ref, onMounted, watch, defineProps } from 'vue'
import { ElEmpty, ElAlert } from 'element-plus'

const props = defineProps({
  // 基于 Vault 的相对路径
  relativePath: { type: String, required: true },
  // 文本编码（默认 utf-8）
  encoding: { type: String, default: 'utf-8' }
})

const content = ref('')
const errorMsg = ref('')

async function loadText() {
  try {
    errorMsg.value = ''
    content.value = ''
    const rel = String(props.relativePath || '').replace(/^\/+|^\\+/, '')
    if (!rel) {
      errorMsg.value = '无效的文件路径'
      return
    }
    const r = await window.api?.fsReadFile?.({ relativePath: rel, encoding: props.encoding })
    if (r?.ok) {
      content.value = String(r.content || '')
    } else {
      errorMsg.value = r?.reason || '读取文本失败'
    }
  } catch (e) {
    errorMsg.value = String(e?.message || e)
  }
}

onMounted(loadText)
watch(() => [props.relativePath, props.encoding], loadText)
</script>

<template>
  <div class="viewer-root">
    <template v-if="errorMsg">
      <ElAlert :title="'文本预览失败：' + errorMsg" type="error" show-icon />
    </template>
    <template v-else-if="content">
      <pre class="text-content"><code>{{ content }}</code></pre>
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
  overflow: auto;
}
.text-content {
  white-space: pre-wrap;
  word-break: break-word;
  padding: 8px;
  margin: 0;
}
</style>
