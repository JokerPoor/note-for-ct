<script setup>
import { ref, onMounted, watch, defineProps } from 'vue'
import { ElEmpty, ElAlert } from 'element-plus'

const props = defineProps({
  relativePath: { type: String, required: true }
})

const fileUrl = ref('')
const errorMsg = ref('')

async function loadUrl() {
  try {
    errorMsg.value = ''
    fileUrl.value = ''
    const rel = String(props.relativePath || '').replace(/^\/+|^\\+/, '')
    if (!rel) {
      errorMsg.value = '无效的文件路径'
      return
    }
    // 读取为 base64 并内联为 data: PDF，避免 file:// 加载被拦截
    const r = await window.api?.fsReadFile?.({ relativePath: rel, encoding: 'base64' })
    if (r?.ok && r.content) {
      fileUrl.value = `data:application/pdf;base64,${r.content}`
    } else {
      errorMsg.value = r?.reason || '读取 PDF 失败'
    }
  } catch (e) {
    errorMsg.value = String(e?.message || e)
  }
}

onMounted(loadUrl)
watch(() => props.relativePath, loadUrl)
</script>

<template>
  <div class="viewer-root">
    <template v-if="errorMsg">
      <ElAlert :title="'PDF 预览失败：' + errorMsg" type="error" show-icon />
    </template>
    <template v-else-if="fileUrl">
      <iframe :src="fileUrl" class="w-full h-full border rounded" />
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
