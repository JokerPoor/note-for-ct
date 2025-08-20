<script setup>
import { onMounted, onBeforeUnmount, ref } from 'vue'
import { useRouter } from 'vue-router'
import { createLogger } from '../utils/logger'

// 欢迎页：负责在应用启动后做最小路由分流
// 规则：
// 1) 若设置中存在 gitOwner 且能从主进程读取到对应凭据，则直接进入笔记页
// 2) 否则进入设置向导页

const router = useRouter()
const left = ref(3) // 自动跳转倒计时（秒）
const statusText = ref('') // 状态提示文案
const busy = ref(false)
let timer = null // 定时器句柄
let keyHandler = null // 键盘事件处理句柄（避免使用 TS 断言）

// 日志器（作用域：欢迎）
const log = createLogger('欢迎')

// 决定下一步路由：根据凭据存在性判定
const decideNext = async () => {
  busy.value = true
  statusText.value = '正在检测凭据…'
  await log.info('开始检测凭据与路由分流')
  let owner = ''
  try {
    const r = await window.api.settingsGet('gitOwner')
    owner = r?.ok && r.value ? r.value : ''
    await log.debug('读取设置 gitOwner 成功：', owner || '(空)')
  } catch (e) {
    await log.warn('读取 gitOwner 失败：', String(e?.message || e))
  }
  owner = (owner || '').trim()
  if (owner) {
    try {
      const r = await window.api.getCredential(owner)
      if (r?.ok) {
        statusText.value = '检测到已保存的凭据，正在进入笔记…'
        await log.info('已找到凭据，跳转到 /notes')
        router.push('/notes')
        return
      }
      await log.info('未找到凭据，进入设置向导')
    } catch (e) {
      await log.error('获取凭据出现异常：', String(e?.message || e))
    }
  }
  statusText.value = '未检测到凭据，将进入设置向导…'
  router.push('/setup')
}

// 手动开始：提前结束倒计时并执行分流
const onStart = async () => {
  if (timer) clearInterval(timer)
  await log.info('用户点击“开始”，立即执行分流')
  decideNext()
}

onMounted(async () => {
  // 页面挂载：启动倒计时，并绑定回车键为“开始”
  await log.debug('已挂载，启动倒计时')
  timer = setInterval(async () => {
    if (left.value <= 1) {
      clearInterval(timer)
      await log.debug('倒计时结束，执行分流')
      decideNext()
    } else {
      left.value -= 1
    }
  }, 1000)

  const onKey = (e) => {
    if (e.key === 'Enter') {
      log.debug('检测到回车键，触发开始')
      onStart()
    }
  }
  window.addEventListener('keydown', onKey)
  // 记录在模块变量，卸载时移除监听
  keyHandler = onKey
})

onBeforeUnmount(async () => {
  if (timer) clearInterval(timer)
  if (keyHandler) {
    window.removeEventListener('keydown', keyHandler)
    keyHandler = null
  }
  await log.debug('已卸载，已清理定时器与事件监听')
})
</script>

<template>
  <!--
    炫酷欢迎页：
    - 全屏自适应背景：多层渐变/光束动画
    - 居中玻璃拟态卡片：带霓虹发光描边
    - 行为：保留原倒计时与自动分流；支持回车触发开始
  -->
  <section class="welcome-wrap">
    <!-- 背景动效层：不参与交互 -->
    <div aria-hidden="true" class="bg-layers">
      <div class="gradient-aurora"></div>
      <div class="beam beam-1"></div>
      <div class="beam beam-2"></div>
      <div class="noise"></div>
    </div>

    <!-- 内容层：居中卡片 -->
    <div class="content">
      <div class="glass-card">
        <div class="glow-border"></div>

        <h1 class="title">
          CuteNotes
          <span class="badge">Beta</span>
        </h1>
        <p class="subtitle">轻巧 · 安全 · 悦目的本地与云同步笔记</p>

        <div class="actions">
          <el-button type="primary" size="large" :loading="busy" :disabled="busy" @click="onStart">
            立即开始
          </el-button>
          <div class="hint">
            <span class="countdown">{{ left }}s</span>
            后自动进入下一步
          </div>
        </div>

        <transition name="fade">
          <p v-if="statusText" class="status">{{ statusText }}</p>
        </transition>
      </div>
    </div>
  </section>
</template>

<style scoped>
/*
 * 欢迎页视觉样式（纯 CSS，无额外依赖）
 * - 采用多层背景 + 模糊 + 动画光束营造“赛博/霓虹”效果
 * - Glassmorphism 卡片，带发光描边
 */

.welcome-wrap {
  position: relative;
  width: 100%;
  height: calc(100vh - 0px); /* 保持与路由视图一致的满屏显示 */
  overflow: hidden;
  background: radial-gradient(1200px 800px at 10% 10%, rgba(59,130,246,.15), transparent 60%),
              radial-gradient(900px 600px at 90% 20%, rgba(236,72,153,.12), transparent 60%),
              radial-gradient(800px 800px at 50% 100%, rgba(16,185,129,.12), transparent 60%),
              #0b0d12;
}

.bg-layers { position: absolute; inset: 0; overflow: hidden; }

.gradient-aurora {
  position: absolute; inset: -30% -30% -30% -30%;
  background: conic-gradient(from 180deg at 50% 50%, rgba(59,130,246,.2), rgba(236,72,153,.18), rgba(16,185,129,.18), rgba(59,130,246,.2));
  filter: blur(60px) saturate(120%);
  animation: spin 30s linear infinite;
  opacity: .6;
}

.beam { position: absolute; width: 120vmax; height: 20vmax; filter: blur(24px); opacity: .25; transform: rotate(-8deg); }
.beam-1 { top: 15%; left: -10%; background: linear-gradient(90deg, transparent, rgba(59,130,246,.6), transparent); animation: sweep 9s ease-in-out infinite; }
.beam-2 { bottom: 10%; left: -20%; background: linear-gradient(90deg, transparent, rgba(236,72,153,.55), transparent); animation: sweep 11s ease-in-out infinite reverse; }

.noise {
  position: absolute; inset: 0;
  background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch"/></filter><rect width="100%" height="100%" filter="url(%23n)" opacity="0.03"/></svg>');
  mix-blend-mode: overlay;
}

.content { position: relative; z-index: 2; width: 100%; height: 100%; display: grid; place-items: center; padding: 24px; }

.glass-card {
  position: relative;
  width: min(760px, 92%);
  padding: 36px 28px 28px;
  border-radius: 18px;
  background: rgba(255,255,255,0.06);
  border: 1px solid rgba(255,255,255,0.16);
  box-shadow: 0 20px 60px rgba(0,0,0,.35), inset 0 1px 0 rgba(255,255,255,.08);
  backdrop-filter: blur(10px) saturate(110%);
}

.glow-border {
  pointer-events: none;
  position: absolute; inset: -2px;
  border-radius: 20px;
  background: linear-gradient(135deg, rgba(59,130,246,.55), rgba(236,72,153,.55), rgba(16,185,129,.55));
  filter: blur(14px);
  opacity: .55;
  animation: pulse 4.2s ease-in-out infinite;
}

.title {
  margin: 0 0 8px; font-size: 42px; line-height: 1.1; font-weight: 800; letter-spacing: .5px;
  background: linear-gradient(90deg, #fff, #c8e1ff 30%, #ffd1e6 65%, #d2ffe9 100%);
  -webkit-background-clip: text; background-clip: text; color: transparent;
  text-shadow: 0 2px 30px rgba(59,130,246,.25);
}
.badge {
  display: inline-block; margin-left: 10px; padding: 2px 8px; font-size: 12px; border-radius: 999px;
  background: rgba(255,255,255,.14); color: #fff; border: 1px solid rgba(255,255,255,.25);
}
.subtitle { margin: 0 0 18px; color: rgba(255,255,255,.75); font-size: 14px; }

.actions { display: flex; align-items: center; gap: 14px; margin: 6px 0 6px; }
.hint { color: rgba(255,255,255,.65); font-size: 12px; }
.countdown { display: inline-block; min-width: 2.5em; text-align: center; color: #fff; font-weight: 700; }

.status { margin-top: 10px; color: rgba(255,255,255,.65); font-size: 12px; }

/* 进入/离开淡入 */
.fade-enter-active, .fade-leave-active { transition: opacity .25s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
@keyframes sweep {
  0%, 100% { transform: translateX(-10%) rotate(-8deg); }
  50% { transform: translateX(20%) rotate(-8deg); }
}
@keyframes pulse {
  0%, 100% { opacity: .55; }
  50% { opacity: .3; }
}

/* 适配暗色/亮色（当前页面以深色为主，提供最小亮色兼容） */
@media (prefers-color-scheme: light) {
  .welcome-wrap { background-color: #eef2ff; }
  .subtitle, .hint, .status { color: rgba(0,0,0,.6); }
}
</style>
