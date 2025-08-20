<script setup>
import { ref, onMounted, watch, defineProps } from 'vue'
import { ElEmpty, ElAlert } from 'element-plus'

const props = defineProps({
  // 基于 Vault 的相对路径
  relativePath: { type: String, required: true }
})

const fileUrl = ref('')
const errorMsg = ref('')

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

async function loadUrl() {
  try {
    errorMsg.value = ''
    fileUrl.value = ''
    const rel = String(props.relativePath || '').replace(/^\/+|^\\+/, '')
    if (!rel) {
      errorMsg.value = '无效的文件路径'
      return
    }
    // 读取为 base64 并内联为 data: URL，避免 file:// 加载被拦截
    const r = await window.api?.fsReadFile?.({ relativePath: rel, encoding: 'base64' })
    if (r?.ok && r.content) {
      const mime = guessMimeByPath(rel)
      fileUrl.value = `data:${mime};base64,${r.content}`
    } else {
      errorMsg.value = r?.reason || '读取图片失败'
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
      <ElAlert :title="'图片预览失败：' + errorMsg" type="error" show-icon />
    </template>
    <template v-else-if="fileUrl">
      <img :src="fileUrl" class="max-w-full max-h-full object-contain" alt="image" />
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
  display: flex;
  align-items: center;
  justify-content: center;
}
</style>
