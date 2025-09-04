import 'element-plus/dist/index.css'
import './assets/index.css'

import { createApp } from 'vue'
import ElementPlus, { ElMessageBox } from 'element-plus'
import App from './App.vue'
import router from './router/index.js'

const app = createApp(App)
  .use(ElementPlus)
  .use(router)
  .mount('#app')

// 全局处理来自主进程的文件打开请求，确保路由跳转
try {
  window.api?.onAppOpenFile?.(async (payload) => {
    try {
      const path = payload?.path
      if (!path) return
      
      // 如果当前不在笔记页，先跳转
      const currentRoute = router.currentRoute.value.path
      if (currentRoute !== '/notes') {
        await router.push('/notes')
        // 等待路由跳转完成
        await new Promise(resolve => setTimeout(resolve, 100))
      }
      
      // 触发页面内的文件打开事件
      window.dispatchEvent(new CustomEvent('global:open-file', { 
        detail: { path } 
      }))
    } catch (e) {
      console.error('全局文件打开处理失败：', e)
    }
  })
} catch (e) {
  console.error('注册全局文件打开监听失败：', e)
}

// 托盘：清空 PAT 并退出 的 UI 确认
try {
  window.api?.onConfirmClearPatQuit?.(async () => {
    try {
      // 可选：确保主界面可见
      try { /* 在渲染端无法直接唤起窗口，这里交由主进程已执行 show/focus */ } catch {}
      await ElMessageBox.confirm(
        '将清空已保存的 PAT 并关闭应用。请先保存所有未保存的文件，并执行同步（Git 推送）。',
        '确认退出',
        {
          confirmButtonText: '确定',
          cancelButtonText: '取消',
          type: 'warning',
          autofocus: false,
          distinguishCancelAndClose: true,
          closeOnClickModal: false,
          closeOnPressEscape: true
        }
      )
      return true
    } catch {
      return false
    }
  })
} catch (e) {
  console.error('注册清空 PAT 确认弹窗失败：', e)
}
