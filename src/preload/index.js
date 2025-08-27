import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// 渲染进程可用的自定义 API（通过 contextBridge 暴露给 window.api）
const api = {
  // 笔记库目录：选择 / 打开
  selectVault: () => ipcRenderer.invoke('vault:select'),
  openVault: (dir) => ipcRenderer.invoke('vault:open', { dir }),

  // 凭据操作（主进程负责实际存储）
  // persist=true 使用 electron-store 持久化；false 仅会话内存
  saveCredential: (account, token, persist = true) => ipcRenderer.invoke('credential:save', { account, token, persist }),
  getCredential: (account) => ipcRenderer.invoke('credential:get', { account }),
  clearCredential: (account) => ipcRenderer.invoke('credential:clear', { account }),

  // Git 操作
  gitInitOrClone: (payload) => ipcRenderer.invoke('git:initOrClone', payload),
  gitStatus: (payload) => ipcRenderer.invoke('git:status', payload),
  gitCommit: (payload) => ipcRenderer.invoke('git:commit', payload),
  gitPullPush: (payload) => ipcRenderer.invoke('git:pullPush', payload),
  gitForceResetToRemote: (payload) => ipcRenderer.invoke('git:forceResetToRemote', payload),
  gitForcePush: (payload) => ipcRenderer.invoke('git:forcePush', payload),

  // Gitee 相关
  giteeCreateRepo: (payload) => ipcRenderer.invoke('gitee:createRepo', payload),
  giteeTest: (payload) => ipcRenderer.invoke('gitee:test', payload),

  // 设置持久化
  settingsGet: (key) => ipcRenderer.invoke('settings:get', { key }),
  settingsSet: (key, value) => ipcRenderer.invoke('settings:set', { key, value }),

  // =====================
  // 文件系统操作（经主进程代理）
  // 说明：相对路径均基于当前 Vault 根目录。
  // =====================
  fsList: (payload) => ipcRenderer.invoke('fs:list', payload),
  fsTree: (payload) => ipcRenderer.invoke('fs:tree', payload),
  fsReadFile: (payload) => ipcRenderer.invoke('fs:readFile', payload),
  fsStat: (payload) => ipcRenderer.invoke('fs:stat', payload),
  fsWriteFile: (payload) => ipcRenderer.invoke('fs:writeFile', payload),
  fsMkdir: (payload) => ipcRenderer.invoke('fs:mkdir', payload),
  fsRename: (payload) => ipcRenderer.invoke('fs:rename', payload),
  fsDelete: (payload) => ipcRenderer.invoke('fs:delete', payload),
  fsOpenPath: (payload) => ipcRenderer.invoke('fs:openPath', payload),
  fsRevealInFolder: (payload) => ipcRenderer.invoke('fs:revealInFolder', payload),

  // 将相对路径转换为 file:// URL（用于渲染端 <img>/<iframe> 等本地预览）
  fsPathToFileUrl: (payload) => ipcRenderer.invoke('fs:pathToFileUrl', payload),

  // 日志相关
  logGetPath: () => ipcRenderer.invoke('log:getPath'),
  logReveal: () => ipcRenderer.invoke('log:reveal'),
  // 渲染进程日志写入（统一到主进程文件）
  logInfo: (...args) => ipcRenderer.invoke('log:write', { level: 'info', args }),
  logWarn: (...args) => ipcRenderer.invoke('log:write', { level: 'warn', args }),
  logError: (...args) => ipcRenderer.invoke('log:write', { level: 'error', args }),
  logDebug: (...args) => ipcRenderer.invoke('log:write', { level: 'debug', args }),

  // 应用信息
  appGetVersion: () => ipcRenderer.invoke('app:getVersion'),
  appGetBuild: () => ipcRenderer.invoke('app:getBuild'),

  // =====================
  // 应用更新（electron-updater，经主进程控制）
  // =====================
  updaterCheck: () => ipcRenderer.invoke('updater:check'),
  updaterDownload: () => ipcRenderer.invoke('updater:download'),
  updaterCancel: () => ipcRenderer.invoke('updater:cancel'),
  updaterInstall: () => ipcRenderer.invoke('updater:install'),
  onUpdaterChecking: (handler) => {
    ipcRenderer.removeAllListeners('updater:checking')
    ipcRenderer.on('updater:checking', () => {
      try { handler && handler() } catch {}
    })
  },
  onUpdaterAvailable: (handler) => {
    ipcRenderer.removeAllListeners('updater:update-available')
    ipcRenderer.on('updater:update-available', (_evt, payload) => {
      try { handler && handler(payload) } catch {}
    })
  },
  onUpdaterNotAvailable: (handler) => {
    ipcRenderer.removeAllListeners('updater:update-not-available')
    ipcRenderer.on('updater:update-not-available', (_evt, payload) => {
      try { handler && handler(payload) } catch {}
    })
  },
  onUpdaterError: (handler) => {
    ipcRenderer.removeAllListeners('updater:error')
    ipcRenderer.on('updater:error', (_evt, payload) => {
      try { handler && handler(payload) } catch {}
    })
  },
  onUpdaterProgress: (handler) => {
    ipcRenderer.removeAllListeners('updater:download-progress')
    ipcRenderer.on('updater:download-progress', (_evt, p) => {
      try { handler && handler(p) } catch {}
    })
  },
  onUpdaterDownloaded: (handler) => {
    ipcRenderer.removeAllListeners('updater:update-downloaded')
    ipcRenderer.on('updater:update-downloaded', (_evt, payload) => {
      try { handler && handler(payload) } catch {}
    })
  },
  onUpdaterCanceled: (handler) => {
    ipcRenderer.removeAllListeners('updater:canceled')
    ipcRenderer.on('updater:canceled', () => {
      try { handler && handler() } catch {}
    })
  },

  // 窗口控制
  winMinimize: () => ipcRenderer.invoke('win:minimize'),
  winToggleMaximize: () => ipcRenderer.invoke('win:toggleMaximize'),
  winClose: () => ipcRenderer.invoke('win:close'),
  winIsMaximized: () => ipcRenderer.invoke('win:isMaximized'),
  onWinMaximizedChanged: (handler) => {
    ipcRenderer.removeAllListeners('win:maximized-changed')
    ipcRenderer.on('win:maximized-changed', (_evt, payload) => {
      try { handler && handler(!!payload?.maximized) } catch {}
    })
  },

  // =====================
  // 退出确认联动（主进程 -> 渲染进程 -> 主进程）
  // =====================
  // 渲染进程注册一个回调，用于在收到主进程的退出询问时进行确认
  // 回调需返回 Promise<boolean> 或 boolean：true=允许退出，false=取消
  onConfirmQuit: (handler) => {
    // 先移除旧监听，避免重复注册
    ipcRenderer.removeAllListeners('app:confirm-quit')
    ipcRenderer.on('app:confirm-quit', async () => {
      let ok = true
      try {
        if (typeof handler === 'function') {
          ok = !!(await handler())
        }
      } catch (e) {
        ok = false
      } finally {
        // 将结果回复给主进程
        ipcRenderer.send('app:confirm-quit:reply', { ok })
      }
    })
  }
}

// 将 Electron 与自定义 API 暴露给渲染进程（在启用上下文隔离时通过 contextBridge）
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // 未启用上下文隔离时，直接挂载到全局（开发或特殊场景）
  window.electron = electronAPI
  window.api = api
}
