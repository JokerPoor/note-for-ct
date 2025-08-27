<template>
  <div class="update-bar" :class="state">
    <template v-if="state === 'idle'">
      <el-button size="small" @click="check">检查更新</el-button>
      <span class="msg">{{ message }}</span>
    </template>

    <template v-else-if="state === 'checking'">
      <span class="msg">正在检查更新…</span>
    </template>

    <template v-else-if="state === 'available'">
      <span class="msg">发现新版本 {{ availableInfo.version || '' }}</span>
      <el-button size="small" type="primary" @click="download" :loading="downloading">下载</el-button>
    </template>

    <template v-else-if="state === 'downloading'">
      <el-progress :percentage="Math.floor(progress.percent)" :stroke-width="6" :show-text="false" class="w-28 mr-2"/>
      <div class="dl-info">
        <span class="msg">{{ Math.floor(progress.percent) }}%</span>
        <span class="sep">·</span>
        <span class="bytes">{{ formatBytes(progress.transferred) }} / {{ formatBytes(progress.total) }}</span>
        <span class="sep">·</span>
        <span class="speed">{{ formatSpeed(progress.bytesPerSecond) }}</span>
        <template v-if="retryCount > 0">
          <span class="sep">·</span>
          <span class="retry">重试中（{{ retryCount }}/{{ maxRetries }}），{{ Math.ceil(nextRetryInMs/1000) }}s 后</span>
        </template>
      </div>
      <el-button size="small" @click="cancel">取消</el-button>
    </template>

    <template v-else-if="state === 'downloaded'">
      <span class="msg">更新包已就绪</span>
      <el-button size="small" type="danger" @click="installNow">立即更新</el-button>
      <el-button size="small" type="primary" @click="onSaveAndInstall">保存并更新</el-button>
    </template>

    <template v-else-if="state === 'error'">
      <span class="msg text-red-500">更新失败：{{ errorMsg }}</span>
      <el-button size="small" @click="retryNow" :loading="retrying">立即重试</el-button>
      <el-button size="small" @click="check">重新检查</el-button>
    </template>

    <template v-else>
      <el-button size="small" @click="check">检查更新</el-button>
    </template>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { ElMessageBox } from 'element-plus'

const emit = defineEmits(['save-and-install'])

const state = ref('idle')
const message = ref('')
const availableInfo = ref({})
const downloading = ref(false)
const progress = ref({ percent: 0, transferred: 0, total: 0, bytesPerSecond: 0 })
const errorMsg = ref('')

// 重试与退避
const retryCount = ref(0)
const maxRetries = 3
let retryTimer = null
let countDownTimer = null
const nextRetryInMsBase = 2000
const nextRetryInMs = ref(0)
const retrying = ref(false)

const clearRetryTimers = () => {
  if (retryTimer) { clearTimeout(retryTimer); retryTimer = null }
  if (countDownTimer) { clearInterval(countDownTimer); countDownTimer = null }
  nextRetryInMs.value = 0
  retrying.value = false
}

const scheduleRetry = () => {
  if (retryCount.value >= maxRetries) return
  const delay = Math.min(30000, nextRetryInMsBase * Math.pow(2, retryCount.value))
  nextRetryInMs.value = delay
  // 倒计时 UI
  if (countDownTimer) clearInterval(countDownTimer)
  countDownTimer = setInterval(() => {
    nextRetryInMs.value = Math.max(0, nextRetryInMs.value - 1000)
    if (nextRetryInMs.value <= 0) {
      clearInterval(countDownTimer); countDownTimer = null
    }
  }, 1000)
  // 真正的重试
  if (retryTimer) clearTimeout(retryTimer)
  retryTimer = setTimeout(async () => {
    retryTimer = null
    retrying.value = true
    retryCount.value += 1
    try {
      await download()
    } finally {
      retrying.value = false
    }
  }, delay)
}

const check = async () => {
  state.value = 'checking'
  try {
    await window.api.updaterCheck()
  } catch (e) {
    state.value = 'error'
    errorMsg.value = String(e?.message || e)
  }
}

const download = async () => {
  clearRetryTimers()
  downloading.value = true
  state.value = 'downloading'
  progress.value = { percent: 0, transferred: 0, total: 0, bytesPerSecond: 0 }
  try {
    const r = await window.api.updaterDownload()
    if (!r?.ok) throw new Error(r?.reason || '下载失败')
  } catch (e) {
    state.value = 'error'
    errorMsg.value = String(e?.message || e)
    downloading.value = false
    // 触发自动重试
    scheduleRetry()
  }
}

const cancel = async () => {
  try {
    await window.api.updaterCancel()
    state.value = 'idle'
    message.value = '已取消下载'
    downloading.value = false
    retryCount.value = 0
    clearRetryTimers()
  } catch (e) {
    // 忽略
  }
}

const installNow = async () => {
  try {
    await ElMessageBox.confirm('应用将退出并安装更新，是否继续？', '安装更新', {
      type: 'warning',
      confirmButtonText: '继续',
      cancelButtonText: '取消',
      autofocus: false,
    })
    await window.api.updaterInstall()
  } catch {}
}

const onSaveAndInstall = () => {
  emit('save-and-install')
}

onMounted(() => {
  window.api.onUpdaterChecking(() => {
    state.value = 'checking'
    errorMsg.value = ''
  })
  window.api.onUpdaterAvailable((payload) => {
    state.value = 'available'
    availableInfo.value = payload || {}
    retryCount.value = 0
    clearRetryTimers()
  })
  window.api.onUpdaterNotAvailable(() => {
    state.value = 'idle'
    message.value = '当前已是最新版本'
    retryCount.value = 0
    clearRetryTimers()
  })
  window.api.onUpdaterError((p) => {
    state.value = 'error'
    errorMsg.value = p?.message || '未知错误'
    downloading.value = false
    // 若处于下载路径中，触发自动重试
    scheduleRetry()
  })
  window.api.onUpdaterProgress((p) => {
    state.value = 'downloading'
    downloading.value = true
    progress.value = p || { percent: 0 }
    // 只要有进展，清理重试计时
    clearRetryTimers()
  })
  window.api.onUpdaterDownloaded(() => {
    state.value = 'downloaded'
    downloading.value = false
    retryCount.value = 0
    clearRetryTimers()
  })
  window.api.onUpdaterCanceled(() => {
    state.value = 'idle'
    message.value = '已取消下载'
    downloading.value = false
    retryCount.value = 0
    clearRetryTimers()
  })
})

onUnmounted(() => {
  // 监听已在 preload 中每次注册前 removeAllListeners，这里无需显式 off
  clearRetryTimers()
})

// 工具函数
const formatBytes = (n) => {
  if (!n && n !== 0) return '-'
  const u = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  let v = Number(n)
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++ }
  return `${v.toFixed(v >= 100 ? 0 : v >= 10 ? 1 : 2)} ${u[i]}`
}
const formatSpeed = (n) => {
  if (!n && n !== 0) return '-'
  const u = ['B/s', 'KB/s', 'MB/s', 'GB/s']
  let i = 0
  let v = Number(n)
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++ }
  return `${v.toFixed(v >= 100 ? 0 : v >= 10 ? 1 : 2)} ${u[i]}`
}

// 立即重试
const retryNow = async () => {
  if (retryCount.value >= maxRetries) return
  clearRetryTimers()
  retrying.value = true
  try {
    retryCount.value += 1
    await download()
  } finally {
    retrying.value = false
  }
}
</script>

<style scoped>
.update-bar {
  position: absolute;
  left: 12px;
  bottom: 30px; /* 避开 .foot-tip 的 6px 行高 */
  background: #ffffffcc;
  backdrop-filter: saturate(180%) blur(4px);
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 4px 8px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: #4b5563;
  box-shadow: 0 4px 10px rgba(0,0,0,0.08);
}
.update-bar .msg { white-space: nowrap; }
.update-bar .dl-info { display: inline-flex; align-items: center; gap: 6px; color: #6b7280; }
.update-bar .sep { color: #9ca3af; }
.w-28 { width: 7rem; }
.mr-2 { margin-right: 0.5rem; }
.text-red-500 { color: #ef4444; }
</style>
