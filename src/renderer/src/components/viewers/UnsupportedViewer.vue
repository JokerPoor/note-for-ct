<script setup>
import { defineProps } from 'vue'
import { ElButton, ElMessage } from 'element-plus'

const props = defineProps({
  relativePath: { type: String, required: true }
})

async function openWithSystem() {
  try {
    const rel = String(props.relativePath || '').replace(/^\/+|^\\+/, '')
    const r = await window.api?.fsOpenPath?.({ relativePath: rel })
    if (!r?.ok) throw new Error(r?.reason || '打开失败')
  } catch (e) {
    ElMessage.error(String(e?.message || e))
  }
}
</script>

<template>
  <div class="unsupported-root">
    <div class="icon">🗂️</div>
    <div class="title">暂不支持的文件类型</div>
    <div class="desc">当前文件：{{ props.relativePath }}</div>
    <div class="tip">您可以使用系统外部程序打开，或将其转换为受支持的格式。</div>
    <div class="actions">
      <ElButton type="primary" size="small" @click="openWithSystem">用系统打开</ElButton>
    </div>
  </div>
</template>

<style scoped>
.unsupported-root {
  width: 100%; height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: #6b7280;
}
.icon { font-size: 32px; margin-bottom: 8px; }
.title { font-weight: 600; color: #374151; margin-bottom: 6px; }
.desc { font-size: 12px; margin-bottom: 4px; }
.tip { font-size: 12px; color: #9ca3af; }
.actions { margin-top: 10px; }
</style>
