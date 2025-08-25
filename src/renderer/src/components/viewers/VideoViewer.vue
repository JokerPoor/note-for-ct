<script setup>
import { ref, onMounted, watch, defineProps, onUnmounted } from 'vue'
import { ElAlert } from 'element-plus'

const props = defineProps({
  relativePath: { type: String, required: true }
})

const srcUrl = ref('')
const errorMsg = ref('')
let objectUrl = ''

function guessMimeByPath(p) {
  try {
    const x = String(p || '').toLowerCase()
    if (x.endsWith('.mp4')) return 'video/mp4'
    if (x.endsWith('.webm')) return 'video/webm'
    if (x.endsWith('.mkv')) return 'video/x-matroska'
    if (x.endsWith('.mov')) return 'video/quicktime'
    if (x.endsWith('.avi')) return 'video/x-msvideo'
    if (x.endsWith('.m4v')) return 'video/x-m4v'
  } catch {}
  return 'application/octet-stream'
}

function revokeObjectUrl() {
  try { if (objectUrl) URL.revokeObjectURL(objectUrl) } catch {}
  objectUrl = ''
}

async function resolveUrl() {
  try {
    errorMsg.value = ''
    srcUrl.value = ''
    revokeObjectUrl()
    const rel = String(props.relativePath || '').replace(/^\/+|^\\+/, '')
    if (!rel) { errorMsg.value = '无效的文件路径'; return }
    // 读取为 base64 -> 转 Blob -> ObjectURL，避免浏览器拦截 file://
    const r = await window.api?.fsReadFile?.({ relativePath: rel, encoding: 'base64' })
    if (r?.ok && r.content) {
      const mime = guessMimeByPath(rel)
      // base64 -> Uint8Array
      const bin = atob(r.content)
      const len = bin.length
      const buf = new Uint8Array(len)
      for (let i = 0; i < len; i++) buf[i] = bin.charCodeAt(i)
      const blob = new Blob([buf], { type: mime })
      objectUrl = URL.createObjectURL(blob)
      srcUrl.value = objectUrl
    } else {
      errorMsg.value = r?.reason || '读取视频失败'
    }
  } catch (e) {
    errorMsg.value = String(e?.message || e)
  }
}

onMounted(resolveUrl)
watch(() => props.relativePath, resolveUrl)
onUnmounted(revokeObjectUrl)
</script>

<template>
  <div class="viewer-root">
    <template v-if="errorMsg">
      <ElAlert :title="'视频预览失败：' + errorMsg" type="error" show-icon />
    </template>
    <template v-else-if="srcUrl">
      <video :src="srcUrl" controls style="width: 100%; height: 100%; max-height: 100%" />
    </template>
  </div>
</template>

<style scoped>
.viewer-root { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; }
</style>
