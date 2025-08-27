import { app, shell, BrowserWindow, ipcMain, dialog, Menu } from 'electron'
import { join, dirname } from 'path'
import { pathToFileURL } from 'url'
import fs from 'fs'
import log from 'electron-log/main'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import simpleGit from 'simple-git'
import axios from 'axios'
import { autoUpdater, CancellationToken } from 'electron-updater'

let mainWindowRef = null

function createWindow() {
  // 创建主窗口
  log.info('[主进程] 正在创建主窗口…')
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    autoHideMenuBar: true,
    frame: false,
    // 在 macOS 使用隐藏标题栏样式以获得更佳外观
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : undefined,
    // 显式指定窗口图标：
    // - Linux 需要此字段用于任务栏/窗口图标
    // - Windows/macOS 在开发环境下可用于窗口图标（任务栏/坞站图标由打包图标决定）
    icon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  // 保存引用用于后续事件广播
  try { mainWindowRef = mainWindow } catch {}

  // =====================
  // 应用版本信息
  // =====================
  ipcMain.handle('app:getVersion', async () => {
    try {
      const v = app.getVersion()
      log.info('[应用版本] 当前版本：', v)
      return { ok: true, version: v }
    } catch (e) {
      log.error('[应用版本] 获取失败：', String(e?.message || e))
      return { ok: false, reason: String(e?.message || e) }
    }
  })

  // 返回应用版本与构建时间（生产环境以打包文件时间为准）
  ipcMain.handle('app:getBuild', async () => {
    try {
      const version = app.getVersion()
      let buildTime = null
      try {
        if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
          // 开发环境：用当前时间表示“构建时间”
          buildTime = new Date()
        } else {
          // 生产环境：读取打包后的 renderer/index.html 的 mtime
          const html = join(__dirname, '../renderer/index.html')
          const stat = fs.statSync(html)
          buildTime = stat?.mtime || null
        }
      } catch (e2) {
        log.warn('[应用构建信息] 无法推断构建时间：', String(e2?.message || e2))
      }
      const buildISO = buildTime ? new Date(buildTime).toISOString() : ''
      log.info('[应用构建信息] version=%s buildTime=%s', version, buildISO)
      return { ok: true, version, buildTime: buildISO }
    } catch (e) {
      log.error('[应用构建信息] 获取失败：', String(e?.message || e))
      return { ok: false, reason: String(e?.message || e) }
    }
  })

  // 从渲染进程写入日志
  // payload: { level: 'info' | 'warn' | 'error' | 'debug', args: any[] }
  ipcMain.handle('log:write', async (_evt, { level = 'info', args = [] } = {}) => {
    try {
      const allowed = ['info', 'warn', 'error', 'debug']
      const lv = allowed.includes(level) ? level : 'info'
      // 将非字符串安全序列化，避免循环引用导致崩溃
      const safeArgs = (Array.isArray(args) ? args : [args]).map((x) => {
        if (typeof x === 'string') return x
        try { return JSON.stringify(x) } catch { return String(x) }
      })
      log[lv]?.('[渲染日志]', ...safeArgs)
      return { ok: true }
    } catch (e) {
      log.error('[渲染日志] 写入失败：', String(e?.message || e))
      return { ok: false, reason: String(e?.message || e) }
    }
  })

  // =====================
  // 日志：路径获取与定位
  // =====================
  ipcMain.handle('log:getPath', async () => {
    try {
      const file = log.transports?.file?.getFile?.()
      const p = file?.path || ''
      log.info('[日志路径] 当前文件:', p || '(空)')
      return { ok: true, path: p }
    } catch (e) {
      return { ok: false, reason: String(e?.message || e) }
    }
  })
  ipcMain.handle('log:reveal', async () => {
    try {
      // 直接打开 logs 目录
      const logsDir = join(app.getPath('userData'), 'logs')
      const target = fs.existsSync(logsDir) ? logsDir : app.getPath('userData')
      await shell.openPath(target)
      return { ok: true, path: target }
    } catch (e) {
      return { ok: false, reason: String(e?.message || e) }
    }
  })

  // 测试 Gitee 连接与仓库可用性
  // payload: { owner, repo?, account }
  ipcMain.handle('gitee:test', async (_evt, { owner, repo, account } = {}) => {
    try {
      if (!owner) return { ok: false, reason: 'owner 为空' }
      let token = null
      if (account) {
        const key = CREDENTIAL_STORE_PREFIX + account
        token = store.get(key) || null
        if (!token) token = tempCredentials.get(account) || null
      }
      if (!token) return { ok: false, reason: '未找到凭据，请先保存 PAT' }

      // 1) 校验 token 有效性
      const userResp = await axios.get('https://gitee.com/api/v5/user', {
        params: { access_token: token }
      })
      const authedUser = userResp?.data?.login
      const tokenOk = !!authedUser

      let repoExists = null
      if (repo) {
        try {
          const r = await axios.get(`https://gitee.com/api/v5/repos/${owner}/${repo}`, {
            params: { access_token: token }
          })
          repoExists = !!r?.data?.name
        } catch (e) {
          const code = e?.response?.status
          if (code === 404) repoExists = false
          else throw e
        }
      }

      return { ok: true, tokenOk, authedUser, repoExists }
    } catch (e) {
      return { ok: false, reason: String(e?.response?.data?.message || e?.message || e) }
    }
  })

  mainWindow.on('ready-to-show', () => {
    log.debug('[主进程] 主窗口 ready-to-show，准备显示')
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    log.info('[主进程] 拦截窗口打开请求，转为外部打开：', details.url)
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // =====================
  // 窗口控制（供渲染进程调用）
  // =====================
  ipcMain.handle('win:minimize', async () => {
    try {
      const w = BrowserWindow.getFocusedWindow() || mainWindow
      w?.minimize()
      return { ok: true }
    } catch (e) {
      return { ok: false, reason: String(e?.message || e) }
    }
  })
  ipcMain.handle('win:toggleMaximize', async () => {
    try {
      const w = BrowserWindow.getFocusedWindow() || mainWindow
      if (!w) return { ok: false, reason: 'no window' }
      if (w.isMaximized()) {
        w.unmaximize()
      } else {
        w.maximize()
      }
      return { ok: true, maximized: w.isMaximized() }
    } catch (e) {
      return { ok: false, reason: String(e?.message || e) }
    }
  })
  ipcMain.handle('win:close', async () => {
    try {
      const w = BrowserWindow.getFocusedWindow() || mainWindow
      w?.close()
      return { ok: true }
    } catch (e) {
      return { ok: false, reason: String(e?.message || e) }
    }
  })

  // 查询当前是否最大化
  ipcMain.handle('win:isMaximized', async () => {
    try {
      const w = BrowserWindow.getFocusedWindow() || mainWindow
      return { ok: true, maximized: !!w?.isMaximized?.() }
    } catch (e) {
      return { ok: false, reason: String(e?.message || e) }
    }
  })

  // 向渲染进程广播窗口最大化状态变化
  try {
    mainWindow.on('maximize', () => {
      try { mainWindow.webContents.send('win:maximized-changed', { maximized: true }) } catch {}
    })
    mainWindow.on('unmaximize', () => {
      try { mainWindow.webContents.send('win:maximized-changed', { maximized: false }) } catch {}
    })
  } catch {}

  // ================
  // 关闭窗口前拦截：与渲染进程联动确认是否允许关闭
  // ================
  const askRendererConfirmQuit = () => {
    return new Promise((resolve) => {
      try {
        const wc = mainWindow?.webContents
        if (!wc) return resolve(true)
        // 仅等待一次回复
        ipcMain.once('app:confirm-quit:reply', (_evt, payload) => {
          const ok = !!(payload && payload.ok)
          log.info('[主进程] 收到渲染进程退出确认：', ok ? '允许' : '取消')
          resolve(ok)
        })
        log.info('[主进程] 发送退出确认请求至渲染进程')
        wc.send('app:confirm-quit')
        // 超时兜底：防止渲染端无响应导致无法退出（默认取消以保护数据）
        setTimeout(() => resolve(false), 15000)
      } catch (e) {
        log.warn('[主进程] 发送退出确认请求失败，默认允许退出：', String(e?.message || e))
        resolve(true)
      }
    })
  }

  let quittingByUserConfirmed = false
  mainWindow.on('close', async (e) => {
    if (quittingByUserConfirmed) return
    e.preventDefault()
    const ok = await askRendererConfirmQuit()
    if (ok) {
      quittingByUserConfirmed = true
      log.info('[主进程] 用户确认后关闭窗口')
      // 使用 destroy 避免再次触发 close 循环
      try { mainWindow.destroy() } catch {}
    } else {
      log.info('[主进程] 用户取消关闭窗口')
    }
  })

  // 渲染进程 HMR（开发环境）与生产环境加载逻辑：
  // 开发环境加载 Vite 提供的远程地址；生产环境加载本地打包后的 HTML 文件。
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    log.info('[主进程] 开发环境，加载渲染地址：', process.env['ELECTRON_RENDERER_URL'])
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    const html = join(__dirname, '../renderer/index.html')
    log.info('[主进程] 生产环境，加载本地文件：', html)
    mainWindow.loadFile(html)
  }
}

// 说明：当 Electron 完成初始化并准备好创建窗口时会调用以下逻辑。
// 注意：只有在此事件之后，部分 API 才可使用。
app.whenReady().then(async () => {
  // 初始化日志：设置日志文件路径与长期保留策略
  try {
    // Configure daily log file path before first write
    const pad = (n) => (n < 10 ? '0' + n : '' + n)
    const d = new Date()
    const dateStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
    const logsDir = join(app.getPath('userData'), 'logs')
    try { if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true }) } catch {}
    log.transports.file.resolvePathFn = () => join(logsDir, `main-${dateStr}.log`)
    // 去除大小限制：根据用户偏好，日志长期保留，不做自动截断
    log.initialize?.()
    log.info('应用启动中…')
    log.info('用户数据目录:', app.getPath('userData'))
    log.info('平台信息:', process.platform, process.versions)
  } catch {}
  // Set app user model id for windows: MUST match electron-builder appId
  // electron-builder.yml -> appId: com.electron.app
  electronApp.setAppUserModelId('com.electron.app')
  try { app.setName('note-for-ct') } catch {}

  // 移除默认应用菜单，避免出现默认的 Electron 菜单项
  try {
    Menu.setApplicationMenu(null)
  } catch {}

  // Windows 任务栏右键菜单（Jump List）清空，避免出现不需要的默认入口
  try {
    if (process.platform === 'win32') {
      app.setUserTasks([])
      app.setJumpList([])
    }
  } catch {}

  // 默认快捷键：开发环境 F12 打开/关闭 DevTools；生产环境忽略 Ctrl/Cmd + R 刷新
  // 参见：https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // 禁用 Git 交互式凭据提示，避免弹出用户名/密码窗口
  try {
    process.env.GIT_ASKPASS = process.env.GIT_ASKPASS || 'echo'
    process.env.GIT_TERMINAL_PROMPT = '0'
  } catch {}

  // =====================
  // 设置持久化：electron-store（文件位于 userData/settings.json）
  // 采用动态导入，确保默认导出兼容（避免“Store is not a constructor”）
  // =====================
  let store
  try {
    const mod = await import('electron-store')
    const ElectronStore = mod?.default || mod
    store = new ElectronStore({ name: 'settings' })
    log.info('[设置] 使用 electron-store，存储文件:', store.path)
  } catch (e) {
    log.error('[设置] 加载 electron-store 失败：', String(e?.message || e))
    // Fallback: no-op store to避免崩溃
    store = {
      get: () => undefined,
      set: () => {},
      delete: () => {}
    }
  }

  ipcMain.handle('settings:get', async (_evt, { key }) => {
    if (!key) return { ok: false, reason: 'key 为空' }
    const value = store.get(key)
    log.info('[设置读取]', key, value === undefined ? '(未设置)' : '(读取成功)')
    return { ok: true, value }
  })
  ipcMain.handle('settings:set', async (_evt, { key, value }) => {
    if (!key) return { ok: false, reason: 'key 为空' }
    store.set(key, value)
    const type = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value
    log.info('[设置写入]', key, `类型=${type}`)
    return { ok: true }
  })

  // =====================
  // IPC 注册（占位实现）
  // 说明：以下实现为最小可跑通版本。
  // =====================

  let currentVaultDir = ''
  const tempCredentials = new Map() // key: account, value: token
  const CREDENTIAL_STORE_PREFIX = 'credentials.' // electron-store 中的命名空间前缀

  // 选择或创建本地笔记库目录
  ipcMain.handle('vault:select', async () => {
    const res = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory']
    })
    if (res.canceled || !res.filePaths?.length) {
      log.info('[仓库选择] 操作已取消')
      return { ok: false, canceled: true }
    }
    const dir = res.filePaths[0]
    currentVaultDir = dir
    log.info('[仓库选择] 目录:', dir)
    return { ok: true, dir }
  })

  // 打开指定的本地笔记库目录
  ipcMain.handle('vault:open', async (_evt, { dir }) => {
    if (!dir || !fs.existsSync(dir)) {
      return { ok: false, reason: '目录不存在或无效' }
    }
    currentVaultDir = dir
    log.info('[仓库打开] 设置当前 Vault 目录：', dir)
    return { ok: true, dir }
  })

  // 保存凭据（支持选择是否持久化：persist=true 使用 electron-store；false 仅会话内存）
  ipcMain.handle('credential:save', async (_evt, { account, token, persist = true }) => {
    if (!account || !token) return { ok: false, reason: '账号或令牌为空' }
    try {
      if (persist) {
        const key = CREDENTIAL_STORE_PREFIX + account
        store.set(key, token)
        tempCredentials.set(account, token) // 同步缓存
        log.info('[凭据保存] 账号:', account, '(store 持久化)')
        return { ok: true, source: 'store' }
      } else {
        // 仅临时保存到内存，不写入持久化
        tempCredentials.set(account, token)
        log.info('[凭据保存] 账号:', account, '(仅内存 persist=false)')
        return { ok: true, tempOnly: true }
      }
    } catch (e) {
      // 任意异常：至少写入内存，避免阻断使用
      tempCredentials.set(account, token)
      log.warn('[凭据保存] 遇到异常，已回退到内存。账号:', account, '错误:', String(e?.message || e))
      return { ok: true, fallback: true, reason: String(e?.message || e) }
    }
  })

  // 读取凭据（优先 electron-store），并返回来源（store/memory）
  ipcMain.handle('credential:get', async (_evt, { account }) => {
    if (!account) return { ok: false, reason: '账号为空' }
    const key = CREDENTIAL_STORE_PREFIX + account
    const tokenFromStore = store.get(key)
    if (tokenFromStore) {
      log.info('[凭据读取] 账号:', account, '(store)')
      return { ok: true, token: tokenFromStore, source: 'store' }
    }
    const token = tempCredentials.get(account)
    if (!token) return { ok: false, reason: '未找到凭据（或已过期）' }
    log.info('[凭据读取] 账号:', account, '(内存)')
    return { ok: true, token, source: 'memory' }
  })

  // 清除凭据（electron-store + 内存）
  ipcMain.handle('credential:clear', async (_evt, { account }) => {
    if (!account) return { ok: false, reason: '账号为空' }
    try {
      const key = CREDENTIAL_STORE_PREFIX + account
      store.delete?.(key)
    } catch {}
    tempCredentials.delete(account)
    return { ok: true }
  })

  // Git 强制重置到远端（强拉：fetch + reset --hard origin/<branch>）
  // payload: { branch }
  ipcMain.handle('git:forceResetToRemote', async (_evt, { branch = 'main' } = {}) => {
    try {
      if (!currentVaultDir) return { ok: false, reason: '尚未选择本地库目录' }
      const git = simpleGit({ baseDir: currentVaultDir })
      await git.fetch('origin', branch).catch(() => {})
      await git.reset(['--hard', `origin/${branch}`])
      log.info('[Git 强拉] 已重置到 origin/%s', branch)
      return { ok: true }
    } catch (e) {
      log.error('[Git 强拉] 失败：', String(e?.message || e))
      return { ok: false, reason: String(e?.message || e) }
    }
  })

  // Git 强制推送（强推：push --force）
  // payload: { owner, repo, branch = 'main', account }
  ipcMain.handle('git:forcePush', async (_evt, { owner, repo, branch = 'main', account } = {}) => {
    try {
      if (!currentVaultDir) return { ok: false, reason: '尚未选择本地库目录' }
      if (!owner || !repo) return { ok: false, reason: 'owner/repo 为空' }
      let token = null
      if (account) {
        const key = CREDENTIAL_STORE_PREFIX + account
        token = store.get(key) || null
        if (!token) token = tempCredentials.get(account) || null
      }
      const base = `https://gitee.com/${owner}/${repo}.git`
      const urlWithCred = token ? `https://${encodeURIComponent(owner)}:${encodeURIComponent(token)}@gitee.com/${owner}/${repo}.git` : base
      const git = simpleGit({ baseDir: currentVaultDir })
      await git.push(urlWithCred, branch, { '--force': null })
      log.info('[Git 强推] 已强制推送到 %s/%s 分支 %s', owner, repo, branch)
      return { ok: true }
    } catch (e) {
      log.error('[Git 强推] 失败：', String(e?.message || e))
      return { ok: false, reason: String(e?.message || e) }
    }
  })

  // Git 初始化或克隆（占位：未接入 simple-git）
  ipcMain.handle('git:initOrClone', async (_evt, { dir, remote, branch = 'main', user, email }) => {
    try {
      if (!dir) return { ok: false, reason: 'dir 为空' }
      if (!fs.existsSync(dir)) return { ok: false, reason: '目录不存在' }
      currentVaultDir = dir
      const git = simpleGit({ baseDir: dir })
      const gitDir = join(dir, '.git')
      const hasGit = fs.existsSync(gitDir)
      if (!hasGit) {
        await git.init()
      }
      if (user) await git.addConfig('user.name', user)
      if (email) await git.addConfig('user.email', email)
      // 配置 origin（不带凭据）
      if (remote) {
        const remotes = await git.getRemotes(true)
        const hasOrigin = remotes.some(r => r.name === 'origin')
        if (!hasOrigin) {
          await git.addRemote('origin', remote)
        } else {
          // 确保 URL 更新为最新 remote（不含凭据）
          await git.remote(['set-url', 'origin', remote])
        }
      }
      // 创建默认分支并做一次初始提交（如需要）
      try { await git.checkoutLocalBranch(branch) } catch {}
      // 若工作区为空跳过提交
      log.info('[Git 初始化/克隆] 完成。目录:', dir, '分支:', branch)
      return { ok: true }
    } catch (e) {
      log.error('[Git 初始化/克隆] 发生错误：', String(e?.message || e))
      return { ok: false, reason: String(e?.message || e) }
    }
  })

  // Git 状态
  ipcMain.handle('git:status', async () => {
    try {
      if (!currentVaultDir) return { ok: false, reason: '尚未选择本地库目录' }
      const git = simpleGit({ baseDir: currentVaultDir })
      const s = await git.status()
      // 仅返回可结构化克隆的纯数据，避免 Electron 报错
      const status = {
        current: s.current,
        tracking: s.tracking,
        ahead: s.ahead,
        behind: s.behind,
        detached: s.detached,
        modified: s.modified,
        created: s.created,
        deleted: s.deleted,
        renamed: s.renamed,
        not_added: s.not_added,
        conflicted: s.conflicted,
        staged: s.staged,
        files: Array.isArray(s.files)
          ? s.files.map((f) => ({ path: f.path, index: f.index, working_dir: f.working_dir }))
          : []
      }
      log.info('[Git 状态] 已获取。当前分支:', status.current, 'ahead:', status.ahead, 'behind:', status.behind)
      return { ok: true, status }
    } catch (e) {
      log.error('[Git 状态] 发生错误：', String(e?.message || e))
      return { ok: false, reason: String(e?.message || e) }
    }
  })

  // Git 提交
  ipcMain.handle('git:commit', async (_evt, { message = 'update notes' } = {}) => {
    try {
      if (!currentVaultDir) return { ok: false, reason: '尚未选择本地库目录' }
      const git = simpleGit({ baseDir: currentVaultDir })
      await git.add(['-A'])
      const res = await git.commit(message).catch(async (err) => {
        // 空提交（nothing to commit），视为成功但无更改
        if (String(err?.message || err).includes('nothing to commit')) return { summary: { changes: 0 } }
        throw err
      })
      log.info('[Git 提交] 完成。信息:', message, '变更统计:', JSON.stringify(res?.summary || {}))
      return { ok: true, summary: res?.summary }
    } catch (e) {
      log.error('[Git 提交] 发生错误：', String(e?.message || e))
      return { ok: false, reason: String(e?.message || e) }
    }
  })

  // Git 同步：pull --rebase 然后 push
  // payload: { owner, repo, branch, account }
  ipcMain.handle('git:pullPush', async (_evt, { owner, repo, branch = 'main', account } = {}) => {
    try {
      if (!currentVaultDir) return { ok: false, reason: '尚未选择本地库目录' }
      if (!owner || !repo) return { ok: false, reason: 'owner/repo 为空' }
      let token = null
      if (account) {
        const key = CREDENTIAL_STORE_PREFIX + account
        token = store.get(key) || null
        if (!token) token = tempCredentials.get(account) || null
      }
      const base = `https://gitee.com/${owner}/${repo}.git`
      const urlWithCred = token ? `https://${encodeURIComponent(owner)}:${encodeURIComponent(token)}@gitee.com/${owner}/${repo}.git` : base
      const git = simpleGit({ baseDir: currentVaultDir })

      // 先尝试拉取（允许失败）
      try { await git.pull(urlWithCred, branch, { '--rebase': null }) } catch {}

      // 首次尝试推送
      try {
        await git.push(urlWithCred, branch)
        log.info('[Git 同步] 推送完成。分支:', branch)
        return { ok: true }
      } catch (pushErr) {
        const msg = String(pushErr?.message || pushErr)
        const mayMissing = /404|Not Found|not found|repository does not exist|Repository not found/i.test(msg)
        if (!mayMissing || !token) {
          // 不是仓库缺失，或无凭据无法创建
          throw pushErr
        }
        // 尝试创建远程仓库
        try {
          const url = 'https://gitee.com/api/v5/user/repos'
          await axios.post(url, null, {
            params: { access_token: token, name: repo, private: 1 }
          })
        } catch (createErr) {
          // 创建失败，返回更明确信息
          return { ok: false, reason: '创建远程仓库失败：' + String(createErr?.response?.data?.message || createErr?.message || createErr) }
        }
        // 创建成功后再推送一次
        await git.push(urlWithCred, branch)
        log.info('[Git 同步] 远程仓库已创建并首推成功。', owner + '/' + repo)
        return { ok: true, created: true }
      }
    } catch (e) {
      log.error('[Git 同步] 发生错误：', String(e?.message || e))
      return { ok: false, reason: String(e?.message || e) }
    }
  })

  // Gitee 创建仓库（简单实现）
  // payload: { owner, repo, private, account }
  ipcMain.handle('gitee:createRepo', async (_evt, { owner, repo, private: isPrivate = true, account } = {}) => {
    try {
      let token = null
      if (account) {
        const key = CREDENTIAL_STORE_PREFIX + account
        token = store.get(key) || null
        if (!token) token = tempCredentials.get(account) || null
      }
      if (!token) return { ok: false, reason: '未找到凭据，请先保存 PAT' }
      if (!owner || !repo) return { ok: false, reason: 'owner/repo 为空' }
      const url = 'https://gitee.com/api/v5/user/repos'
      const res = await axios.post(url, null, {
        params: {
          access_token: token,
          name: repo,
          private: isPrivate ? 1 : 0
        }
      })
      return { ok: true, data: res.data }
    } catch (e) {
      return { ok: false, reason: String(e?.response?.data?.message || e?.message || e) }
    }
  })

  // =====================
  // 文件系统操作（最小实现）
  // 说明：仅使用 Node 内置 fs/path，操作当前选择的 Vault 目录。
  // 前端请确保先通过 vault:select 或 vault:open 设置好 currentVaultDir。
  // =====================

  // 列出目录树（简化：仅一层，后续可替换为递归/fast-glob）
  ipcMain.handle('fs:list', async (_evt, { subdir = '' } = {}) => {
    if (!currentVaultDir) return { ok: false, reason: '尚未选择本地库目录' }
    const target = join(currentVaultDir, subdir)
    if (!fs.existsSync(target)) return { ok: false, reason: '目标目录不存在' }
    const entries = fs.readdirSync(target, { withFileTypes: true })
    const list = entries.map((d) => ({
      name: d.name,
      isDir: d.isDirectory()
    }))
    log.info('[FS 列表] 目录：', target, '条目数：', list.length)
    return { ok: true, dir: target, list }
  })

  // 递归列出目录树
  // payload: { subdir: string } 相对当前 Vault 的子目录，例如 'notes'
  // 返回：{ ok, dir, tree: Array<Node> }；Node = { name, path, isDir, children? }
  ipcMain.handle('fs:tree', async (_evt, { subdir = '' } = {}) => {
    try {
      if (!currentVaultDir) return { ok: false, reason: '尚未选择本地库目录' }
      const rootAbs = join(currentVaultDir, subdir)
      if (!fs.existsSync(rootAbs)) return { ok: false, reason: '目标目录不存在' }
      const walk = (absDir, relDir) => {
        const entries = fs.readdirSync(absDir, { withFileTypes: true })
        const nodes = []
        for (const d of entries) {
          const childAbs = join(absDir, d.name)
          const childRel = relDir ? `${relDir}/${d.name}` : d.name
          const isDir = d.isDirectory()
          const node = { name: d.name, path: childRel, isDir }
          if (isDir) node.children = walk(childAbs, childRel)
          nodes.push(node)
        }
        return nodes
      }
      const tree = walk(rootAbs, subdir)
      log.info('[FS 目录树] 根：', rootAbs, '节点数：', Array.isArray(tree) ? tree.length : 0)
      return { ok: true, dir: rootAbs, tree }
    } catch (e) {
      log.error('[FS 目录树] 构建失败：', String(e?.message || e))
      return { ok: false, reason: String(e?.message || e) }
    }
  })

  // 读取文件（相对 Vault 的路径）
  ipcMain.handle('fs:readFile', async (_evt, { relativePath, encoding = 'utf-8' }) => {
    if (!currentVaultDir) return { ok: false, reason: '尚未选择本地库目录' }
    if (!relativePath) return { ok: false, reason: 'relativePath 为空' }
    const file = join(currentVaultDir, relativePath)
    if (!fs.existsSync(file)) return { ok: false, reason: '文件不存在' }
    const content = fs.readFileSync(file, encoding)
    log.info('[FS 读取] 文件：', file, '编码：', encoding)
    return { ok: true, content }
  })

  // 获取文件/目录 stat（用于判断大小、类型等）
  ipcMain.handle('fs:stat', async (_evt, { relativePath }) => {
    try {
      if (!currentVaultDir) return { ok: false, reason: '尚未选择本地库目录' }
      if (!relativePath) return { ok: false, reason: 'relativePath 为空' }
      const target = join(currentVaultDir, relativePath)
      if (!fs.existsSync(target)) return { ok: false, reason: '目标不存在' }
      const st = fs.statSync(target)
      return {
        ok: true,
        size: st.size,
        isFile: st.isFile(),
        isDirectory: st.isDirectory(),
        mtimeMs: st.mtimeMs,
        ctimeMs: st.ctimeMs,
        atimeMs: st.atimeMs
      }
    } catch (e) {
      return { ok: false, reason: String(e?.message || e) }
    }
  })

  // 将相对路径转换为可在渲染进程使用的 file:// URL
  ipcMain.handle('fs:pathToFileUrl', async (_evt, { relativePath }) => {
    try {
      if (!currentVaultDir) return { ok: false, reason: '尚未选择本地库目录' }
      if (!relativePath) return { ok: false, reason: 'relativePath 为空' }
      const abs = join(currentVaultDir, relativePath)
      if (!fs.existsSync(abs)) return { ok: false, reason: '目标不存在' }
      const url = String(pathToFileURL(abs))
      return { ok: true, url }
    } catch (e) {
      return { ok: false, reason: String(e?.message || e) }
    }
  })

  // 使用系统默认程序打开 Vault 内的文件或目录
  ipcMain.handle('fs:openPath', async (_evt, { relativePath }) => {
    try {
      if (!currentVaultDir) return { ok: false, reason: '尚未选择本地库目录' }
      if (!relativePath) return { ok: false, reason: 'relativePath 为空' }
      const abs = join(currentVaultDir, relativePath)
      if (!fs.existsSync(abs)) return { ok: false, reason: '目标不存在' }
      const res = await shell.openPath(abs)
      if (res) {
        // shell.openPath 返回非空字符串表示错误
        return { ok: false, reason: res }
      }
      return { ok: true, path: abs }
    } catch (e) {
      return { ok: false, reason: String(e?.message || e) }
    }
  })

  // 在系统文件管理器中显示并选中该文件/目录
  ipcMain.handle('fs:revealInFolder', async (_evt, { relativePath }) => {
    try {
      if (!currentVaultDir) return { ok: false, reason: '尚未选择本地库目录' }
      if (!relativePath) return { ok: false, reason: 'relativePath 为空' }
      const abs = join(currentVaultDir, relativePath)
      if (!fs.existsSync(abs)) return { ok: false, reason: '目标不存在' }
      // showItemInFolder 接受文件路径；若是目录，也会打开该目录
      shell.showItemInFolder(abs)
      return { ok: true, path: abs }
    } catch (e) {
      return { ok: false, reason: String(e?.message || e) }
    }
  })

  // 写入文件（创建/覆盖）
  ipcMain.handle('fs:writeFile', async (_evt, { relativePath, content, encoding = 'utf-8' }) => {
    if (!currentVaultDir) return { ok: false, reason: '尚未选择本地库目录' }
    if (!relativePath) return { ok: false, reason: 'relativePath 为空' }
    const file = join(currentVaultDir, relativePath)
    // 确保上级目录存在
    const parentDir = dirname(file)
    if (parentDir && !fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true })
    }
    fs.writeFileSync(file, content ?? '', { encoding })
    log.info('[FS 写入] 文件：', file, '大小：', String((content ?? '').length), '编码：', encoding)
    return { ok: true, path: file }
  })

  // 创建目录（递归）
  ipcMain.handle('fs:mkdir', async (_evt, { relativePath }) => {
    if (!currentVaultDir) return { ok: false, reason: '尚未选择本地库目录' }
    if (!relativePath) return { ok: false, reason: 'relativePath 为空' }
    const dir = join(currentVaultDir, relativePath)
    try {
      fs.mkdirSync(dir, { recursive: true })
      log.info('[FS 新建目录] 目录：', dir)
      return { ok: true, path: dir }
    } catch (e) {
      log.error('[FS 新建目录] 失败：', dir, String(e?.message || e))
      return { ok: false, reason: String(e?.message || e) }
    }
  })

  // 重命名/移动文件或目录
  ipcMain.handle('fs:rename', async (_evt, { from, to }) => {
    if (!currentVaultDir) return { ok: false, reason: '尚未选择本地库目录' }
    if (!from || !to) return { ok: false, reason: 'from/to 不能为空' }
    const src = join(currentVaultDir, from)
    const dst = join(currentVaultDir, to)
    const dstDir = dirname(dst)
    if (dstDir && !fs.existsSync(dstDir)) fs.mkdirSync(dstDir, { recursive: true })
    fs.renameSync(src, dst)
    log.info('[FS 重命名] 从：', src, '到：', dst)
    return { ok: true }
  })

  // 删除文件或目录（谨慎：简单实现）
  ipcMain.handle('fs:delete', async (_evt, { relativePath }) => {
    if (!currentVaultDir) return { ok: false, reason: '尚未选择本地库目录' }
    if (!relativePath) return { ok: false, reason: 'relativePath 为空' }
    const target = join(currentVaultDir, relativePath)
    if (!fs.existsSync(target)) return { ok: true }
    // 优先移动到系统回收站
    try {
      await shell.trashItem(target)
      log.info('[FS 删除] 已移动到回收站：', target)
      return { ok: true, trashed: true }
    } catch (e) {
      // 兜底：物理删除（仅在回收站失败时）
      try {
        const stat = fs.statSync(target)
        if (stat.isDirectory()) {
          if (fs.rm) {
            fs.rmSync(target, { recursive: true, force: true })
          } else {
            const del = (p) => {
              for (const name of fs.readdirSync(p)) {
                const c = join(p, name)
                const s = fs.statSync(c)
                s.isDirectory() ? del(c) : fs.unlinkSync(c)
              }
              fs.rmdirSync(p)
            }
            del(target)
          }
        } else {
          fs.unlinkSync(target)
        }
        log.warn('[FS 删除] 回收站失败，已执行物理删除：', target, String(e?.message || e))
        return { ok: true, trashed: false, fallback: true }
      } catch (e2) {
        log.error('[FS 删除] 失败：', target, 'trashErr=', String(e?.message || e), 'removeErr=', String(e2?.message || e2))
        return { ok: false, reason: String(e2?.message || e2) }
      }
    }
  })

  createWindow()

  // =====================
  // 自动更新：事件转发 + IPC 控制（禁用静默安装）
  // =====================
  let cancelToken = null
  try {
    // 让 electron-updater 使用 electron-log 输出
    try {
      autoUpdater.logger = log
      autoUpdater.logger.transports.file.level = 'info'
    } catch {}

    // 禁止自动下载与自动安装，交由渲染进程控制
    try {
      autoUpdater.autoDownload = false
      autoUpdater.autoInstallOnAppQuit = false
      // Windows 上允许在安装时后台静默，第二个参数建议 true（isSilentWhenInstall=true）
    } catch {}

    // 主 -> 渲染：状态事件
    autoUpdater.on('checking-for-update', () => {
      try { log.info('[更新] 正在检查…') } catch {}
      try { mainWindowRef?.webContents?.send('updater:checking') } catch {}
    })
    autoUpdater.on('update-available', (info) => {
      try { log.info('[更新] 可用：', info?.version || '') } catch {}
      try { mainWindowRef?.webContents?.send('updater:update-available', { version: info?.version, releaseName: info?.releaseName, releaseNotes: info?.releaseNotes }) } catch {}
    })
    autoUpdater.on('update-not-available', (info) => {
      try { log.info('[更新] 暂无可用更新') } catch {}
      try { mainWindowRef?.webContents?.send('updater:update-not-available', { info }) } catch {}
    })
    autoUpdater.on('error', (err) => {
      try { log.error('[更新] 错误：', String(err?.message || err)) } catch {}
      try { mainWindowRef?.webContents?.send('updater:error', { message: String(err?.message || err) }) } catch {}
    })
    autoUpdater.on('download-progress', (p) => {
      const payload = {
        percent: p?.percent || 0,
        transferred: p?.transferred || 0,
        total: p?.total || 0,
        bytesPerSecond: p?.bytesPerSecond || 0
      }
      try { log.info('[更新] 下载中：', Math.floor(payload.percent) + '%') } catch {}
      try { mainWindowRef?.webContents?.send('updater:download-progress', payload) } catch {}
    })
    autoUpdater.on('update-downloaded', (info) => {
      try { log.info('[更新] 下载完成：', info?.version || '') } catch {}
      // 由渲染进程决定何时安装
      try { mainWindowRef?.webContents?.send('updater:update-downloaded', { version: info?.version }) } catch {}
    })

    // 渲染 -> 主：控制命令
    ipcMain.handle('updater:check', async () => {
      try {
        if (is.dev) {
          // 开发环境下仅回传事件，避免真实网络请求
          mainWindowRef?.webContents?.send('updater:update-not-available', {})
          return { ok: true, dev: true }
        }
        mainWindowRef?.webContents?.send('updater:checking')
        const res = await autoUpdater.checkForUpdates()
        return { ok: true, result: !!res }
      } catch (e) {
        return { ok: false, reason: String(e?.message || e) }
      }
    })

    ipcMain.handle('updater:download', async () => {
      try {
        if (is.dev) return { ok: false, reason: '开发环境不下载更新' }
        // 若已有下载在进行，先尝试取消
        try { cancelToken?.cancel?.() } catch {}
        cancelToken = new CancellationToken()
        await autoUpdater.downloadUpdate(cancelToken)
        return { ok: true }
      } catch (e) {
        return { ok: false, reason: String(e?.message || e) }
      }
    })

    ipcMain.handle('updater:cancel', async () => {
      try {
        if (cancelToken) {
          cancelToken.cancel()
          cancelToken = null
          try { mainWindowRef?.webContents?.send('updater:canceled') } catch {}
          return { ok: true, canceled: true }
        }
        return { ok: true, canceled: false }
      } catch (e) {
        return { ok: false, reason: String(e?.message || e) }
      }
    })

    ipcMain.handle('updater:install', async () => {
      try {
        if (is.dev) return { ok: false, reason: '开发环境不支持安装更新' }
        // 第二个参数 isSilentWhenInstall=true，避免额外系统对话框
        autoUpdater.quitAndInstall(false, true)
        return { ok: true }
      } catch (e) {
        return { ok: false, reason: String(e?.message || e) }
      }
    })

    // 启动时不自动安装，只检查一次（可选）
    if (!is.dev) {
      try { autoUpdater.checkForUpdates().catch(() => {}) } catch {}
    } else {
      log.info('[更新] 开发环境，已注册 IPC 与事件但不实际联网')
    }
  } catch (e) {
    try { log.error('[更新] 初始化异常：', String(e?.message || e)) } catch {}
  }

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  // 除 macOS 外，关闭所有窗口即退出应用
  if (process.platform !== 'darwin') {
    log.info('[主进程] 所有窗口已关闭，准备退出应用')
    app.quit()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
