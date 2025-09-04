<template>
  <section class="about-page card-cute">
    <!-- Hero 区域 -->
    <header class="hero">
      <div class="hero-left">
        <div class="logo">📝</div>
        <div class="title-wrap">
          <h1 class="title">关于应用</h1>
          <p class="subtitle">轻巧的 Markdown 笔记，专注写作与稳定同步。</p>
          <div class="badges">
            <el-tag size="small" type="success">Electron</el-tag>
            <el-tag size="small" type="info">Vue 3</el-tag>
            <el-tag size="small" type="warning">Element Plus</el-tag>
            <el-tag v-if="version" size="small" type="info">v{{ version }}</el-tag>
            <el-tag v-if="buildTimeText" size="small">构建：{{ buildTimeText }}</el-tag>
          </div>
        </div>
      </div>
      <div class="hero-actions">
        <el-button type="primary" @click="$router.push('/notes')">开始写作</el-button>
        <el-button @click="$router.push('/setup')">打开设置</el-button>
      </div>
    </header>

    <el-divider />

    <!-- 信息宫格 -->
    <div class="info-grid">
      <!-- 应用信息 -->
      <el-card shadow="never" class="info-card">
        <template #header>
          <div class="card-head">
            <span>应用信息</span>
          </div>
        </template>
        <ul class="list">
          <li><span class="k">技术栈</span><span class="v">Electron · Vue 3 · Element Plus</span></li>
          <li><span class="k">凭据存储</span><span class="v">electron-store（持久化设置存储，可选加密）</span></li>
          <li><span class="k">日志</span><span class="v">按天分文件，位于 用户数据/logs</span></li>
        </ul>
      </el-card>

      <!-- 日志工具 -->
      <el-card shadow="never" class="info-card">
        <template #header>
          <div class="card-head">
            <span>日志</span>
          </div>
        </template>
        <div class="log-tools">
          <div class="buttons">
            <el-button type="primary" size="small" @click="onOpenLog">打开日志文件夹</el-button>
            <el-button size="small" @click="onCopyLogPath" :disabled="!logPath">复制当日日志路径</el-button>
          </div>
          <div class="log-path" :title="logPath">
            {{ logPath || '正在获取日志路径…' }}
          </div>
        </div>
      </el-card>

      <!-- 使用说明 -->
      <el-card shadow="never" class="info-card">
        <template #header>
          <div class="card-head">
            <span>使用说明</span>
          </div>
        </template>
        <ul class="bullet">
          <li>支持本地仓库与 Gitee 远程同步</li>
          <li>在「设置向导」中配置 Owner、仓库与凭据（PAT）</li>
          <li>同步异常时可先查看日志定位问题</li>
        </ul>
      </el-card>

      

      
    </div>

    <footer class="footer">
      <div class="copyright">
        © {{ new Date().getFullYear() }} Notes. Made with ♥ for productivity.
      </div>
    </footer>
  </section>
</template>

<script setup>
import { onMounted, ref, computed } from 'vue'
import { ElMessage } from 'element-plus'
import { createLogger } from '../utils/logger'

// 日志器（作用域：关于）
const log = createLogger('关于')

// 当前日志文件路径（当日）
const logPath = ref('')
// 版本与构建时间
const version = ref('')
const buildTimeText = ref('')
// 已移除：版本更新展示

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
  // 获取版本与构建时间
  try {
    const r = await window.api.appGetBuild?.()
    if (r?.ok) {
      version.value = r.version || ''
      // 将 ISO 构建时间转为本地可读
      if (r.buildTime) {
        try {
          const d = new Date(r.buildTime)
          const pad = (n) => (n < 10 ? '0' + n : '' + n)
          buildTimeText.value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
        } catch {}
      }
      await log.info('已获取版本与构建时间：', version.value, buildTimeText.value)
    } else {
      await log.warn('获取版本/构建时间失败：', r?.reason || '')
    }
  } catch (e) {
    await log.warn('获取版本/构建时间异常：', String(e?.message || e))
  }
})
</script>

<style scoped>
.about-page {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.hero {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.hero-left { display: flex; align-items: center; gap: 12px; min-width: 0; }
.logo { font-size: 32px; line-height: 1; }
.title-wrap { min-width: 0; }
.title { font-size: 18px; margin: 0; }
.subtitle { margin: 4px 0 6px; color: #6b7280; font-size: 13px; }
.badges :deep(.el-tag) { margin-right: 6px; }
.hero-actions { display: flex; gap: 8px; flex-shrink: 0; }

.info-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 12px;
}
@media (min-width: 900px) {
  .info-grid { grid-template-columns: 1fr 1fr; }
}
.info-card :deep(.el-card__header) {
  padding: 10px 12px;
}
.info-card :deep(.el-card__body) {
  padding: 12px;
}
.card-head { font-weight: 600; color: #374151; }
.list { list-style: none; padding: 0; margin: 0; }
.list li { display: flex; justify-content: space-between; padding: 6px 0; gap: 12px; }
.list .k { color: #6b7280; font-size: 13px; }
.list .v { color: #111827; font-size: 13px; }
.bullet { list-style: disc; padding-left: 18px; color: #6b7280; }
.bullet li { padding: 4px 0; }
.log-tools .buttons { display: flex; gap: 8px; margin-bottom: 6px; }
.log-tools .log-path { font-size: 12px; color: #6b7280; word-break: break-all; }
/* 已移除：版本更新模块样式 */

.footer {
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px solid #eee;
  color: #9ca3af;
  font-size: 12px;
  text-align: center;
}
</style>
