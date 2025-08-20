import { createRouter, createWebHashHistory } from 'vue-router'
import { ElMessage } from 'element-plus'
import { createLogger } from '../utils/logger'

// 路由对应的页面组件
import Setup from '../pages/Setup.vue'
import Welcome from '../pages/Welcome.vue'
import Notes from '../pages/Notes.vue'
import About from '../pages/About.vue'

// 路由表：保持简单的顶层页面结构
const routes = [
  { path: '/', redirect: '/welcome' },
  { path: '/setup', component: Setup, meta: { title: '设置向导' } },
  { path: '/welcome', component: Welcome, meta: { title: '欢迎' } },
  { path: '/notes', component: Notes, meta: { title: '笔记' } },
  { path: '/about', component: About, meta: { title: '关于' } }
]

// 创建路由实例（Hash 模式便于打包分发）
const router = createRouter({
  history: createWebHashHistory(),
  routes
})

// 作用域日志器
const log = createLogger('Router')

// 全局前置守卫：
// - 访问 /notes 时，软校验 vault 与 PAT 状态
// - 记录导航日志（来源路由、目标路由）
router.beforeEach(async (to, from, next) => {
  try { await log.info('即将导航：', from.fullPath, '->', to.fullPath) } catch {}
  if (to.path === '/notes') {
    let hasVault = false
    try {
      const r = await window.api.settingsGet('vaultDir')
      hasVault = !!(r?.ok && r.value)
    } catch {}
    if (!hasVault) {
      try { await log.warn('拦截进入 /notes：未选择 vault，跳转到 /setup') } catch {}
      return next('/setup')
    }

    // 软校验 PAT：无则提示但允许进入
    let owner = ''
    try {
      const rOwner = await window.api.settingsGet('gitOwner')
      owner = (rOwner?.ok && rOwner.value ? rOwner.value : '').trim()
    } catch {}
    if (owner) {
      try {
        const r = await window.api.getCredential(owner)
        if (!r?.ok) {
          ElMessage.warning('未检测到 PAT，请先在「设置」中保存凭据以启用同步')
          try { await log.warn('检测到无 PAT：owner=', owner) } catch {}
        }
      } catch {
        ElMessage.warning('无法检测 PAT，请稍后重试或前往「设置」')
        try { await log.error('检测 PAT 发生异常') } catch {}
      }
    } else {
      ElMessage.info('未填写 Owner，建议前往「设置」完善后再同步')
      try { await log.warn('未填写 Owner，允许进入 /notes') } catch {}
    }
  }
  next()
})

// 全局后置钩子：设置页面标题，并记录成功导航
router.afterEach((to) => {
  if (to.meta?.title) document.title = `笔记 · ${to.meta.title}`
  try { log.info('已导航到：', to.fullPath) } catch {}
})

export default router
