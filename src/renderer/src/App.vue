<script setup>
import { useRoute } from 'vue-router'
import { computed, ref, onMounted, onBeforeUnmount } from 'vue'
import { ElConfigProvider } from 'element-plus'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import en from 'element-plus/es/locale/lang/en'
import {
  Setting,
  Document,
  InfoFilled,
  Refresh,
  ArrowDownBold,
  ArrowUpBold,
  Minus,
  FullScreen,
  Close,
  CopyDocument
} from '@element-plus/icons-vue'
import { createLogger } from './utils/logger'
import ElectronLogo from './assets/electron.svg'

const route = useRoute()
// 日志器（作用域：App）
const log = createLogger('App')
const active = computed(() => route.path)
const isTopLevel = computed(() => ['/setup', '/welcome'].includes(active.value))
const isNotes = computed(() => active.value.startsWith('/notes'))

// Element Plus 全局配置（默认：小号 + 中文）
const epSize = ref('small') // 'large' | 'default' | 'small'
const epLocale = ref(zhCn)
const cfgVersion = ref(0)
// 应用版本（用于左下角显示）
const appVersion = ref('')
// 顶部导航是否折叠（隐藏）
const navCollapsed = ref(false)
// 窗口是否最大化（用于动态切换图标）
const isMaximized = ref(false)

// 读取 UI 偏好（大小/语言），来源：设置持久化
const loadUiPrefs = async () => {
  try {
    await log.debug('读取 UI 偏好')
    const r1 = await window.api.settingsGet('uiSize')
    const r2 = await window.api.settingsGet('uiLang')
    const size = r1?.ok && r1.value ? r1.value : 'small'
    const lang = r2?.ok && r2.value ? r2.value : 'zh-CN'
    epSize.value = ['large', 'default', 'small'].includes(size) ? size : 'small'
    epLocale.value = lang === 'en' ? en : zhCn
    cfgVersion.value++
    await log.info('UI 偏好已应用：', { size: epSize.value, lang })
  } catch {}
}

// 设置变更事件处理（来自设置页触发的自定义事件）
const onConfigChanged = () => {
  log.debug('收到 app:configChanged 事件，重新加载 UI 偏好')
  loadUiPrefs()
}

// 获取应用版本信息（由主进程提供）
const loadAppVersion = async () => {
  try {
    const r = await window.api.appGetVersion()
    appVersion.value = r?.ok ? r.version : ''
    await log.info('已获取应用版本：', appVersion.value || '(空)')
  } catch (e) {
    await log.warn('获取应用版本失败：', String(e?.message || e))
  }
}

onMounted(() => {
  log.info('挂载：初始化 UI 偏好与 PAT 指示')
  loadUiPrefs()
  window.addEventListener('app:configChanged', onConfigChanged)
  loadAppVersion()
  // 初始化并监听最大化状态
  try {
    window.api?.winIsMaximized?.().then((r) => {
      if (r?.ok) isMaximized.value = !!r.maximized
    }).catch(() => {})
    window.api?.onWinMaximizedChanged?.((max) => {
      isMaximized.value = !!max
    })
  } catch {}
})

onBeforeUnmount(() => {
  window.removeEventListener('app:configChanged', onConfigChanged)
  log.debug('卸载：移除事件监听')
})

// 切换顶部导航折叠状态（收起/展开）
function toggleNav() {
  try {
    navCollapsed.value = !navCollapsed.value
    log.info('已切换系统导航折叠状态：', String(navCollapsed.value))
  } catch {}
}

// 窗口控制事件（避免在模板中直接访问 window）
function onWinMinimize() {
  try { window.api?.winMinimize?.() } catch {}
}
function onWinToggleMaximize() {
  try {
    const p = window.api?.winToggleMaximize?.()
    if (p && typeof p.then === 'function') {
      p.then((r) => {
        if (r?.ok && 'maximized' in r) isMaximized.value = !!r.maximized
      }).catch(() => {})
    }
  } catch {}
}
function onWinClose() {
  try { window.api?.winClose?.() } catch {}
}
</script>

<template>
  <el-config-provider :size="epSize" :locale="epLocale" :key="cfgVersion">
    <!-- 全局容器：去除左右留白，充满宽度 -->
    <div class="app-wrap">
      <div v-if="isTopLevel">
        <router-view />
      </div>

      <!-- 正常页面：顶部菜单栏 + 下方内容区 -->
      <div v-else :class="{ 'nav-collapsed': navCollapsed }">
        <!-- 顶部导航：固定在页面顶部 -->
        <header class="app-header">
          <div class="flex items-center justify-between h-11 px-2 header-inner drag-region">
            <div class="flex items-center gap-2">
              <img class="app-logo-img" :src="ElectronLogo" alt="logo" />
              <div class="drag-hint" aria-hidden="true"></div>
            </div>
            <div class="flex items-center gap-1.5 no-drag">
              <el-tooltip content="笔记" placement="bottom">
                <router-link to="/notes">
                  <el-button circle :type="active === '/notes' ? 'primary' : 'default'">
                    <el-icon><Document /></el-icon>
                  </el-button>
                </router-link>
              </el-tooltip>
              <el-tooltip content="关于" placement="bottom">
                <router-link to="/about">
                  <el-button circle :type="active === '/about' ? 'primary' : 'default'">
                    <el-icon><InfoFilled /></el-icon>
                  </el-button>
                </router-link>
              </el-tooltip>
              <el-tooltip content="设置" placement="bottom">
                <router-link to="/setup">
                  <el-button :icon="Setting" circle />
                </router-link>
              </el-tooltip>
              <div class="h-5 w-px bg-gray-200 mx-1"></div>
              <!-- 窗口控制：最小化 / 最大化 / 关闭 -->
              <el-tooltip content="最小化" placement="bottom">
                <el-button circle @click="onWinMinimize" aria-label="最小化">
                  <el-icon><Minus /></el-icon>
                </el-button>
              </el-tooltip>
              <el-tooltip :content="isMaximized ? '还原' : '最大化'" placement="bottom">
                <el-button circle @click="onWinToggleMaximize" :aria-label="isMaximized ? '还原' : '最大化'">
                  <transition name="fade">
                    <el-icon :key="isMaximized ? 'restore' : 'maximize'">
                      <component :is="isMaximized ? CopyDocument : FullScreen" />
                    </el-icon>
                  </transition>
                </el-button>
              </el-tooltip>
              <el-tooltip content="关闭" placement="bottom">
                <el-button circle type="danger" @click="onWinClose" aria-label="关闭">
                  <el-icon><Close /></el-icon>
                </el-button>
              </el-tooltip>
              <!-- 分隔线（窗口控制 与 导航折叠 之间） -->
              <div class="h-5 w-px bg-gray-200 mx-1"></div>
              <!-- 折叠切换按钮（位于最右侧） -->
              <el-tooltip :content="navCollapsed ? '展开导航' : '收起导航'" placement="bottom">
                <el-button
                  circle
                  :icon="navCollapsed ? ArrowDownBold : ArrowUpBold"
                  @click="toggleNav"
                  aria-label="切换导航显隐"
                />
              </el-tooltip>
            </div>
          </div>
        </header>

        <!-- 折叠后仍保留一个悬浮小按钮用于展开导航 -->
        <el-button
          v-if="navCollapsed"
          class="nav-toggle-floating"
          circle
          :icon="ArrowDownBold"
          type="primary"
          @click="toggleNav"
          :title="navCollapsed ? '展开导航' : '收起导航'"
          aria-label="展开导航"
        />

        <main class="app-main px-2" :class="{ 'with-nav': !navCollapsed, 'no-nav': navCollapsed }">
          <router-view />
        </main>
      </div>
    </div>
  </el-config-provider>
  <!-- 左下角固定显示应用版本（不拦截点击） -->
  <div class="fixed left-2 bottom-2 text-xs text-gray-400 select-none pointer-events-none">
    v{{ appVersion || '—' }}
  </div>
</template>

<style scoped>
/* 全局容器充满宽度，去除左右留白 */
.app-wrap {
  width: 100vw;
  max-width: 100vw;
  padding: 0; /* 移除左右内边距 */
}

/* 顶部导航固定样式 */
.app-header {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 1000;
}
.header-inner {
  background: #fff;
  border-bottom: 1px solid #eee;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.04);
}

/* 内容区域：根据导航显示状态留出顶部空间 */
.app-main.with-nav {
  /* 提供给子组件的全局变量：导航栏高度 */
  --app-header-height: 44px;
  padding-top: 44px;
}
.app-main.no-nav {
  --app-header-height: 0px;
  padding-top: 8px;
}

/* 折叠后保留的悬浮按钮（右上角） */
.nav-toggle-floating {
  position: fixed;
  top: 6px;
  right: 10px;
  z-index: 1001;
  /* 使用 Element Plus 按钮，主要控制过渡与定位 */
  transition: opacity 0.2s ease, transform 0.2s ease;
}
.nav-toggle-floating:hover {
  opacity: 0.9;
}

/* 折叠时隐藏导航条（通过外层类控制，可加动画） */
.nav-collapsed .app-header {
  transform: translateY(-100%);
  transition: transform 0.2s ease;
}
.app-header {
  transition: transform 0.2s ease;
}

/* 顶部左侧应用图标样式 */
.app-logo-img {
  height: 18px;
  display: block;
}

/* 无边框窗口：可拖拽区域与非拖拽区域 */
.drag-region {
  -webkit-app-region: drag;
  user-select: none;
  cursor: grab;
}

.no-drag {
  -webkit-app-region: no-drag;
}

.drag-region:active {
  cursor: grabbing;
}

/* 细微的拖拽握把（靠近 LOGO），仅作视觉提示 */
.drag-hint {
  width: 10px;
  height: 14px;
  margin-left: 4px;
  opacity: 0.25;
  pointer-events: none;
  /* 由多个小点构成的握把效果 */
  background-image:
    radial-gradient(currentColor 1px, transparent 1px),
    radial-gradient(currentColor 1px, transparent 1px);
  background-position: 0 0, 5px 7px;
  background-size: 5px 7px;
  color: #999;
  border-radius: 2px;
}
.drag-region:hover .drag-hint {
  opacity: 0.45;
}

/* 图标淡入淡出过渡（用于最大化/还原切换） */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.15s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
