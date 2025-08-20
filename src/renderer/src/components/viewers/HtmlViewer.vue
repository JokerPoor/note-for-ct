<script setup>
import { ref, onMounted, watch, defineProps } from 'vue'
import { ElEmpty, ElAlert } from 'element-plus'

const props = defineProps({
  relativePath: { type: String, required: true }
})

const htmlContent = ref('')
const errorMsg = ref('')

async function loadHtml() {
  try {
    errorMsg.value = ''
    htmlContent.value = ''
    const rel = String(props.relativePath || '').replace(/^\/+|^\\+/, '')
    if (!rel) {
      errorMsg.value = '无效的文件路径'
      return
    }
    const r = await window.api?.fsReadFile?.({ relativePath: rel, encoding: 'utf-8' })
    if (r?.ok) {
      htmlContent.value = String(r.content || '')
    } else {
      errorMsg.value = r?.reason || '读取 HTML 失败'
    }
  } catch (e) {
    errorMsg.value = String(e?.message || e)
  }
}

onMounted(loadHtml)
watch(() => props.relativePath, loadHtml)
</script>

<template>
  <div class="viewer-root">
    <template v-if="errorMsg">
      <ElAlert :title="'HTML 预览失败：' + errorMsg" type="error" show-icon />
    </template>
    <template v-else-if="htmlContent">
      <iframe class="w-full h-full border rounded" :srcdoc="htmlContent" />
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
