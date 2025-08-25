<script setup>
import { defineProps } from 'vue'
import { ElAlert, ElButton, ElSpace } from 'element-plus'

const props = defineProps({
  relativePath: { type: String, required: true }
})

async function openWithSystem() {
  const rel = String(props.relativePath || '').replace(/^\/+|^\\+/, '')
  try {
    const r = await window.api?.fsOpenPath?.({ relativePath: rel })
    if (!r?.ok) throw new Error(r?.reason || '打开失败')
  } catch (e) {
    // 交给外层消息处理或静默
    console.error(e)
  }
}
</script>

<template>
  <div class="viewer-root">
    <ElAlert
      title="暂不支持在应用内直接预览 Office 文件（doc/xls/ppt 等）"
      description="可点击下方按钮使用系统默认程序打开。后续将考虑集成本地转换或在线预览方案。"
      type="info"
      show-icon
    />
    <div class="mt-2">
      <ElSpace>
        <ElButton type="primary" @click="openWithSystem">在系统中打开</ElButton>
      </ElSpace>
    </div>
  </div>
</template>

<style scoped>
.viewer-root { width: 100%; height: 100%; padding: 12px; }
</style>
