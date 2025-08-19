<template>
  <section class="card-cute">
    <!-- 标题与简介 -->
    <div class="mb-3">
      <h2 class="section-title mb-1">关于</h2>
      <p class="text-gray-600">轻巧的 Markdown 笔记，支持 Gitee 同步与本地仓库管理。</p>
    </div>

    <!-- 信息区块 -->
    <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
      <div class="p-3 rounded border border-gray-100" style="background:#fafafa;">
        <div class="text-sm text-gray-500 mb-1">应用信息</div>
        <ul class="text-gray-600 text-sm leading-6">
          <li>技术栈：Electron · Vue 3 · Element Plus</li>
          <li>凭据存储：Keytar（本机安全存储）</li>
          <li>日志：按天分文件，位于用户数据/logs</li>
        </ul>
      </div>
      <div class="p-3 rounded border border-gray-100" style="background:#fafafa;">
        <div class="text-sm text-gray-500 mb-1">日志</div>
        <div class="flex items-center gap-2 mb-2">
          <el-button type="primary" size="small" @click="onOpenLog">
            打开日志文件夹
          </el-button>
          <el-button size="small" @click="onCopyLogPath" :disabled="!logPath">
            复制当日日志路径
          </el-button>
        </div>
        <div class="text-xs text-gray-500 break-all" :title="logPath">
          {{ logPath || '正在获取日志路径…' }}
        </div>
      </div>
    </div>

    <!-- 说明列表 -->
    <ul class="text-gray-500 list-disc pl-5 space-y-1">
      <li>支持本地仓库与 Gitee 远程同步</li>
      <li>可在设置中配置 Owner、仓库与凭据（PAT）</li>
      <li>遇到问题可前往“关于”页面打开日志文件夹查看详情</li>
    </ul>
  </section>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { createLogger } from '../utils/logger'

// 日志器（作用域：关于）
const log = createLogger('关于')

// 当前日志文件路径（当日）
const logPath = ref('')

// 加载当日日志路径
const loadLogPath = async () => {
  try {
    await log.debug('开始获取当日日志路径')
    const r = await window.api.logGetPath()
    if (r?.ok) {
      logPath.value = r.path || ''
      await log.info('已获取当日日志路径：', logPath.value)
    } else {
      await log.warn('获取日志路径失败：', r?.reason || '')
    }
  } catch (e) {
    await log.error('获取日志路径异常：', String(e?.message || e))
  }
}

// 打开日志所在文件夹
const onOpenLog = async () => {
  try {
    await log.debug('点击“打开日志文件夹”')
    const r = await window.api.logReveal()
    if (!r?.ok) throw new Error(r?.reason || '打开失败')
    await log.info('已打开日志文件夹')
  } catch (e) {
    ElMessage.error(String(e?.message || e))
    await log.error('打开日志文件夹失败：', String(e?.message || e))
  }
}

// 复制当日日志路径到剪贴板
const onCopyLogPath = async () => {
  const text = logPath.value || ''
  if (!text) {
    ElMessage.info('暂无可复制的日志路径')
    await log.warn('复制日志路径被跳过：当前为空')
    return
  }
  try {
    await navigator.clipboard.writeText(text)
    ElMessage.success('已复制当日日志路径')
    await log.info('已复制日志路径到剪贴板')
  } catch (e) {
    // 某些环境不允许访问剪贴板
    await log.warn('复制到剪贴板失败，尝试降级提示：', String(e?.message || e))
    try {
      // 降级方案：选中文本由用户手动复制（此处仅提示）
      ElMessage.info('复制失败，请手动选择并复制上方路径')
    } catch {}
  }
}

onMounted(async () => {
  await log.info('页面挂载：准备读取日志信息')
  await loadLogPath()
})
</script>
