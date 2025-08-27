<script setup>
// 页面：笔记主界面
// - 左侧：文件列表（带搜索/刷新/新建图标按钮）
// - 右侧：编辑区域（当前文件信息、保存图标按钮、命中预览图标导航）
// - 保持中文注释与日志
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import MarkdownEditor from '../components/MarkdownEditor.vue'
import { ElMessageBox, ElMessage } from 'element-plus'
import { useRouter, onBeforeRouteLeave } from 'vue-router'
import { createLogger } from '../utils/logger'
// 文件类型判定与多类型查看器组件
import { getFileKind } from '../fileTypes.js'
import FileViewer from '../components/FileViewer.vue'
import UpdateBar from '../components/UpdateBar.vue'
// 图标（Element Plus）
import {
  Search,
  Plus,
  Refresh,
  Delete as DeleteIcon,
  Document,
  Folder,
  FolderAdd,
  ArrowLeftBold,
  ArrowRightBold,
  Check,
  Setting,
  Notebook
} from '@element-plus/icons-vue'
// Iconify（用于丰富的文件/目录图标）
import { Icon, addCollection } from '@iconify/vue'
import vscodeIcons from '@iconify-json/vscode-icons/icons.json'
import mdiIcons from '@iconify-json/mdi/icons.json'

// 预注册图标集合（离线可用）
try {
  addCollection(vscodeIcons)
  addCollection(mdiIcons)
} catch {}

// 更新条触发：保存并安装
const onSaveAndInstallFromBar = async () => {
  try {
    const needSave = !!(
      currentFile.value && (
        editorText.value !== lastSavedText.value ||
        saveStatus.value === 'dirty' ||
        saveStatus.value === 'saving'
      )
    )
    if (needSave) {
      saveStatus.value = 'saving'
      const ok = await saveCurrent({ silent: true })
      if (!ok) {
        ElMessage.error('保存失败，已取消更新')
        return
      }
    }
    await ElMessageBox.confirm('应用将退出并安装更新，是否继续？', '安装更新', {
      type: 'warning',
      confirmButtonText: '继续',
      cancelButtonText: '取消',
      autofocus: false,
    })
    await window.api.updaterInstall()
  } catch (e) {
    ElMessage.error(String(e?.message || e))
  }
}

// 日志器（作用域：笔记）
const log = createLogger('笔记')

// 与 App.vue 中一致的最小笔记 CRUD 逻辑（基于 preload 暴露的 fs IPC）
const vaultDir = ref('')
// 扁平文件列表（仅文件，用于全文检索等逻辑）
const files = ref([])
// 树形数据（支持多级目录）
const treeData = ref([])
const treeRef = ref(null)
// 当前选中的树节点（用于在该目录中新建、批量操作等）
const selectedNode = ref(null)
// 右键菜单状态
const contextMenuShow = ref(false)
const contextMenuX = ref(0)
const contextMenuY = ref(0)
const contextNode = ref(null)
const contextMenuRef = ref(null)
const contextBlank = ref(false) // 是否为空白区域右键
const currentFile = ref('')
const editorText = ref('')
// 自动保存开关与最近一次保存的文本
const autoSave = ref(true) // 是否启用自动保存
const lastSavedText = ref('') // 记录最近一次保存成功的文本，用于避免打开文件后立即触发保存
// 轻量化保存状态：idle | dirty | saving | saved
const saveStatus = ref('idle')
const saveAt = ref('') // 最近保存时间（HH:mm:ss）
let _autoSaveTimer = null // 自动保存防抖计时器
// Markdown 编辑器引用（用于选择与聚焦）
const mdRef = ref(null)
// 编辑器预览主题（与 MarkdownEditor.vue 的 theme 对应）
const editorTheme = ref('github') // 可选：github | dark | classic | solarized | sepia | nord | ctbb
const THEME_KEY = 'notes.editorTheme'
const validThemes = ['github', 'dark', 'classic', 'solarized', 'sepia', 'nord', 'ctbb']

// 当前文件类型（基于扩展名）
const currentKind = computed(() => (currentFile.value ? getFileKind(currentFile.value) : 'unsupported'))

// 读取 Git 配置（从 settings），返回 { owner, repo, branch, account }

// ================
// 文件/目录图标映射（Iconify）
// ================
function getIconName(path, isDir, isOpen) {
  if (isDir) {
    // 使用 MDI 离线图标以避免因缺失而触发 Iconify 网络请求
    return isOpen ? 'mdi:folder-open' : 'mdi:folder-outline'
  }
  const p = String(path || '')
  const norm = p.replace(/\\/g, '/')
  const base = norm.split('/').pop() || ''
  const baseLower = base.toLowerCase()
  const ext = (baseLower.includes('.') ? baseLower.split('.').pop() : '')

  // 特殊文件名优先匹配
  if (baseLower === 'dockerfile') return 'mdi:docker'
  if (baseLower === 'package.json') return 'mdi:npm'
  if (baseLower === 'package-lock.json') return 'mdi:lock'
  if (baseLower === 'pnpm-lock.yaml' || baseLower === 'yarn.lock') return 'mdi:lock'
  if (baseLower === 'readme' || baseLower === 'readme.md') return 'mdi:book-open-variant'
  if (baseLower === 'license' || baseLower.startsWith('license.')) return 'mdi:certificate-outline'
  if (baseLower === '.gitignore' || baseLower === '.gitattributes') return 'mdi:git'
  if (baseLower === '.editorconfig') return 'vscode-icons:file-type-editorconfig'
  if (baseLower.startsWith('.env')) return 'mdi:leaf'
  if (baseLower.startsWith('.prettier')) return 'vscode-icons:file-type-prettier'
  if (baseLower.startsWith('.eslintrc')) return 'vscode-icons:file-type-eslint'

  const map = {
    // 多媒体
    jpg: 'vscode-icons:file-type-image',
    jpeg: 'vscode-icons:file-type-image',
    png: 'vscode-icons:file-type-image',
    gif: 'vscode-icons:file-type-image',
    bmp: 'vscode-icons:file-type-image',
    webp: 'vscode-icons:file-type-image',
    svg: 'vscode-icons:file-type-svg',
    ico: 'vscode-icons:file-type-image',
    tiff: 'vscode-icons:file-type-image',
    tif: 'vscode-icons:file-type-image',
    avif: 'vscode-icons:file-type-image',
    heic: 'vscode-icons:file-type-image',
    heif: 'vscode-icons:file-type-image',
    mp4: 'vscode-icons:file-type-video',
    mov: 'vscode-icons:file-type-video',
    avi: 'vscode-icons:file-type-video',
    mkv: 'vscode-icons:file-type-video',
    webm: 'vscode-icons:file-type-video',
    mp3: 'vscode-icons:file-type-audio',
    wav: 'vscode-icons:file-type-audio',
    flac: 'vscode-icons:file-type-audio',
    amr: 'vscode-icons:file-type-audio',
    aac: 'vscode-icons:file-type-audio',
    ogg: 'vscode-icons:file-type-audio',
    m4a: 'vscode-icons:file-type-audio',
    opus: 'vscode-icons:file-type-audio',
    // 文档
    pdf: 'mdi:file-pdf-box',
    csv: 'mdi:file-delimited',
    tsv: 'mdi:file-delimited',
    xml: 'mdi:file-xml',
    doc: 'vscode-icons:file-type-word',
    docx: 'vscode-icons:file-type-word',
    xls: 'vscode-icons:file-type-excel',
    xlsx: 'vscode-icons:file-type-excel',
    ppt: 'vscode-icons:file-type-powerpoint',
    pptx: 'vscode-icons:file-type-powerpoint',
    // 文本/代码
    md: 'vscode-icons:file-type-markdown',
    mdx: 'vscode-icons:file-type-markdown',
    txt: 'vscode-icons:file-type-text',
    html: 'vscode-icons:file-type-html',
    css: 'vscode-icons:file-type-css',
    js: 'vscode-icons:file-type-js',
    ts: 'vscode-icons:file-type-ts',
    jsx: 'mdi:react',
    tsx: 'mdi:react',
    vue: 'vscode-icons:file-type-vue',
    json: 'vscode-icons:file-type-json',
    yaml: 'vscode-icons:file-type-yaml',
    yml: 'vscode-icons:file-type-yaml',
    toml: 'mdi:language-markdown-outline',
    ini: 'mdi:tune-variant',
    sh: 'mdi:console',
    bash: 'mdi:console',
    bat: 'mdi:console',
    ps1: 'mdi:powershell',
    py: 'mdi:language-python',
    java: 'mdi:language-java',
    kt: 'mdi:language-kotlin',
    go: 'mdi:language-go',
    rs: 'mdi:language-rust',
    php: 'mdi:language-php',
    rb: 'mdi:language-ruby',
    cs: 'mdi:language-csharp',
    c: 'mdi:language-c',
    h: 'mdi:language-c',
    cpp: 'mdi:language-cpp',
    hpp: 'mdi:language-cpp',
    swift: 'mdi:language-swift',
    scala: 'mdi:language-scala',
    rsx: 'mdi:react',
    sql: 'mdi:database',
    // 压缩/包
    zip: 'vscode-icons:file-type-zip',
    rar: 'vscode-icons:file-type-zip',
    '7z': 'vscode-icons:file-type-zip',
    gz: 'vscode-icons:file-type-zip',
    tgz: 'vscode-icons:file-type-zip',
    bz2: 'vscode-icons:file-type-zip',
    xz: 'vscode-icons:file-type-zip',
    zst: 'vscode-icons:file-type-zip'
  }
  return map[ext] || 'mdi:file-outline'
}

// 基于 path 的扁平文件提取：从 fsTree 返回结构里找出所有文件路径（相对 src，不含根名）
const flattenFilesFromTree = (root, srcAbs) => {
  const out = []
  const norm = (s) => String(s || '').replace(/\\/g, '/')
  const srcNorm = norm(srcAbs)
  const srcAlt = srcNorm.startsWith('notes/') ? srcNorm.slice('notes/'.length) : srcNorm
  const isDirectory = (n) => !!(n?.isDir || n?.isDirectory || (n?.type === 'directory'))
  const visit = (n, curAbsDir) => {
    if (!n) return
    if (Array.isArray(n)) { n.forEach((c) => visit(c, curAbsDir)); return }
    if (typeof n === 'string') {
      // 仅有文件名，归属到当前目录
      const relDir = curAbsDir.startsWith(srcNorm + '/') ? curAbsDir.slice(srcNorm.length + 1) : ''
      const relPath = relDir ? `${relDir}/${n}` : n
      if (relPath) out.push(norm(relPath))
      return false
    }
    let p = n?.path ? norm(n.path) : ''
    const nm = n?.name || (p ? p.split('/').pop() : '')
    if (isDirectory(n)) {
      // 目录：优先用当前目录 + name，避免依赖 path 的前缀正确性
      const nextDir = nm ? `${curAbsDir}/${nm}` : (p && (p.startsWith('notes/') ? p : (`notes/${p}`))) || curAbsDir
      const kids = [...(n.children || []), ...(n.items || []), ...(n.entries || []), ...(n.files || [])]
      kids.forEach((c) => visit(c, nextDir || curAbsDir))
      return
    }
    // 文件节点：优先使用 path；若无 path，则用 name 挂到当前目录
    if (p) {
      const prefixes = [
        `${srcNorm}/`,
        `${srcAlt}/`
      ]
      let matched = false
      for (const pref of prefixes) {
        if (p.startsWith(pref)) {
          out.push(p.slice(pref.length))
          matched = true
          break
        }
      }
      if (!matched) {
        // 前缀不匹配：使用当前目录 + basename(p)
        const relDir = curAbsDir.startsWith(srcNorm + '/') ? curAbsDir.slice(srcNorm.length + 1) : (curAbsDir.startsWith('notes/' + srcAlt + '/') ? curAbsDir.slice(('notes/' + srcAlt).length + 1) : '')
        const nameOnly = p.split('/').pop()
        const relPath = relDir ? `${relDir}/${nameOnly}` : nameOnly
        if (relPath) out.push(norm(relPath))
      }
    } else {
      const nameOnly = nm || n?.filename || n?.label
      if (nameOnly) {
        const relDir = curAbsDir.startsWith(srcNorm + '/') ? curAbsDir.slice(srcNorm.length + 1) : (curAbsDir.startsWith('notes/' + srcAlt + '/') ? curAbsDir.slice(('notes/' + srcAlt).length + 1) : '')
        const relPath = relDir ? `${relDir}/${nameOnly}` : nameOnly
        if (relPath) out.push(norm(relPath))
      }
    }
  }
  visit(root, srcNorm)
  return out
}

// 兜底：按 { name, path, isDir, children } 形状提取（loadNotesList 所用形状）
const collectFilesByKnownShape = (root, baseName) => {
  const dirs = new Set()
  const files = []
  const addDir = (p) => { if (p) dirs.add(p) }
  const pushFile = (p) => { if (p) files.push(p) }
  const walk = (arr, prefix) => {
    if (!Array.isArray(arr)) return
    for (const n of arr) {
      const nm = n?.name || (n?.path ? String(n.path).split('/').pop() : null)
      if (!nm) continue
      const cur = prefix ? `${prefix}/${nm}` : nm
      if (n?.isDir) {
        addDir(cur)
        walk(n.children || [], cur)
      } else {
        pushFile(cur)
      }
    }
  }
  if (Array.isArray(root)) walk(root, baseName)
  else if (root && typeof root === 'object') walk(root.children || [], baseName || (root.name || ''))
  return { dirs: Array.from(dirs), files }
}

// 复制进度状态（大目录并发复制时显示）
const copyInProgress = ref(false)
const copyDone = ref(0)
const copyTotal = ref(0)
const startCopyProgress = (total) => {
  copyTotal.value = total || 0
  copyDone.value = 0
  copyInProgress.value = total > 0
}
const incCopyProgress = () => { copyDone.value += 1 }
const endCopyProgress = () => { copyInProgress.value = false }


// 并发池：限制同时异步任务数（处理完整队列）
async function runWithConcurrency(items, limit, worker) {
  const L = Math.max(1, Math.min(limit || 1, items.length || 0))
  const results = []
  let index = 0
  async function runner() {
    while (index < items.length) {
      const cur = index++
      const item = items[cur]
      const r = await worker(item)
      results.push(r)
    }
  }
  const workers = Array.from({ length: L }, () => runner())
  await Promise.all(workers)
  return results
}

// 目录辅助
const exists = async (rel) => {
  const st = await window.api.fsStat({ relativePath: rel })
  return !!st?.ok
}
const ensureDir = async (rel) => {
  const r = await window.api.fsMkdir({ relativePath: rel })
  return !!r?.ok || false
}
const mkdirp = async (rel) => {
  const parts = String(rel).split('/').filter(Boolean)
  let cur = ''
  for (const p of parts) {
    cur = cur ? `${cur}/${p}` : p
    // 尝试创建，已存在则忽略
    const st = await window.api.fsMkdir({ relativePath: cur })
    if (!st?.ok && st?.reason && !/已存在|exists/i.test(String(st.reason))) {
      // 可能主进程实现返回 ok=false 当已存在，这里直接忽略错误
    }
  }
}
const collectTree = (node, base = '') => {
  // 返回 {dirs: string[], files: string[]}，均为以根名开头的相对路径
  const dirs = []
  const files = []
  const getName = (n) => n?.name || n?.filename || n?.label || (n?.path ? String(n.path).split('/').pop() : null)
  const isDirectory = (n) => !!(n?.isDir || n?.isDirectory || (n?.type === 'directory'))
  const walk = (n, prefix) => {
    if (!n) return
    if (Array.isArray(n)) {
      n.forEach((c) => walk(c, prefix))
      return
    }
    if (typeof n === 'string') {
      const nameOnly = n.includes('/') ? n.split('/').pop() : n
      const cur = prefix ? `${prefix}/${nameOnly}` : nameOnly
      files.push(cur)
      return
    }
    const nm = getName(n)
    if (!nm) return
    const cur = prefix ? `${prefix}/${nm}` : nm
    if (isDirectory(n)) {
      dirs.push(cur)
      const childNodes = [...(n.children || []), ...(n.items || []), ...(n.entries || []), ...(n.dirs || [])]
      childNodes.forEach((c) => walk(c, cur))
      // 某些实现可能把文件列表放在 n.files（对象或字符串）
      ;(n.files || []).forEach((f) => {
        if (!f) return
        if (typeof f === 'string') {
          const nameOnly = f.includes('/') ? f.split('/').pop() : f
          files.push(cur ? `${cur}/${nameOnly}` : nameOnly)
        } else {
          walk(f, cur)
        }
      })
    } else {
      files.push(cur)
    }
  }
  if (node) walk(node, base)
  return { dirs, files }
}

const ensureUniqueDirName = async (parentDir, name) => {
  // 规则：优先使用 name-副本；若仍冲突，则 name-副本 (2)/(3)...
  const base = String(name)
  // 若不冲突，直接返回原名
  if (!(await exists(`${parentDir}/${base}`))) return base
  let candidate = `${base}-副本`
  if (!(await exists(`${parentDir}/${candidate}`))) return candidate
  let idx = 2
  while (await exists(`${parentDir}/${candidate}`)) {
    candidate = `${base}-副本 (${idx})`
    idx += 1
  }
  return candidate
}

const chooseConflictForRoot = async (isDir, dstDir, name) => {
  // 返回 { action: 'overwrite'|'skip'|'rename', newName? }
  try {
    const ret = await ElMessageBox.confirm(
      `${isDir ? '目录' : '文件'}已存在：${dstDir}/${name}，是否覆盖？`,
      '目标已存在',
      {
        confirmButtonText: '覆盖',
        cancelButtonText: '其它…',
        type: 'warning',
        distinguishCancelAndClose: true
      }
    )
    if (ret === 'confirm') return { action: 'overwrite' }
  } catch {
    // 用户点了“其它…”或关闭
  }
  // 询问重命名；留空或取消视作跳过
  try {
    // 计算一个带 “-副本” 的默认建议名
    let suggest = name
    if (isDir) {
      suggest = await ensureUniqueDirName(dstDir, `${name}-副本`)
    } else {
      const { base, ext } = splitExt(name)
      const target = await ensureUniquePath(dstDir, `${base}-副本${ext}`)
      suggest = String(target).split('/').pop()
    }
    const { value, action } = await ElMessageBox.prompt(
      '输入新的名称（留空则跳过）',
      '重命名',
      {
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        inputPlaceholder: suggest,
        inputValue: suggest
      }
    )
    const newName = String(value || '').trim()
    if (!newName) return { action: 'skip' }
    // 对目录名做唯一化
    const finalName = isDir ? await ensureUniqueDirName(dstDir, newName) : newName
    return { action: 'rename', newName: finalName }
  } catch {
    return { action: 'skip' }
  }
}

// “逐个”模式：是否对所有后续冲突应用同一选择
const askApplyAll = ref(false)
let askChosenAction = null // 'overwrite' | 'skip' | 'rename'
const confirmApplyAllForAsk = async (actionLabel) => {
  try {
    const ret = await ElMessageBox.confirm(
      `是否将“${actionLabel}”应用到所有后续冲突？`,
      '应用到所有',
      { confirmButtonText: '是', cancelButtonText: '否', distinguishCancelAndClose: true }
    )
    if (ret === 'confirm') {
      askApplyAll.value = true
      askChosenAction = actionLabel === '覆盖' ? 'overwrite' : actionLabel === '跳过' ? 'skip' : 'rename'
    }
  } catch {}
}

// 路径工具
const dirname = (p) => (String(p || '').split('/').slice(0, -1).join('/') || 'notes')
const basename = (p) => (String(p || '').split('/').pop() || '')
const splitExt = (name) => {
  const i = String(name).lastIndexOf('.')
  if (i <= 0) return { base: String(name), ext: '' }
  return { base: String(name).slice(0, i), ext: String(name).slice(i) }
}
// 生成不冲突的目标路径（文件）：优先 base-副本.ext，其后 base-副本 (2).ext ...
const ensureUniquePath = async (dir, name) => {
  const original = String(name)
  const { base, ext } = splitExt(original)
  // 原名不冲突
  let rel = `${dir}/${original}`
  let st = await window.api.fsStat({ relativePath: rel })
  if (!st?.ok) return rel
  // 尝试 -副本
  let candidate = `${base}-副本${ext}`
  rel = `${dir}/${candidate}`
  st = await window.api.fsStat({ relativePath: rel })
  if (!st?.ok) return rel
  // 递增 -副本 (n)
  let idx = 2
  while (true) {
    candidate = `${base}-副本 (${idx})${ext}`
    rel = `${dir}/${candidate}`
    st = await window.api.fsStat({ relativePath: rel })
    if (!st?.ok) return rel
    idx += 1
  }
}
const getActiveDir = () => {
  // 优先：当前右键上下文
  if (!contextBlank.value && contextNode.value) {
    return contextNode.value.isDir ? contextNode.value.path : dirname(contextNode.value.path)
  }
  // 空白区域：以当前选中目录或当前文件所在目录为准
  if (selectedNode.value) {
    return selectedNode.value.isDir ? selectedNode.value.path : dirname(selectedNode.value.path)
  }
  if (currentFile.value) return dirname(currentFile.value)
  return 'notes'
}

// 剪贴板（文件复制/剪切）
const clipboard = ref({ mode: null, path: '', isDir: false }) // mode: 'copy' | 'cut'
const hasClipboard = computed(() => !!(clipboard.value?.mode && clipboard.value.path))
const setClipboard = (mode, node) => {
  if (!node) return
  clipboard.value = { mode, path: node.path, isDir: !!node.isDir }
  try { log.info('剪贴板：', mode, node.path) } catch {}
}
const clearClipboard = () => {
  clipboard.value = { mode: null, path: '', isDir: false }
}

const onCopy = (node) => {
  if (!node) return
  setClipboard('copy', node)
  contextMenuShow.value = false
}
const onCut = (node) => {
  if (!node) return
  // 根目录不允许剪切
  if (node.path === 'notes') return
  setClipboard('cut', node)
  contextMenuShow.value = false
}
const onPaste = async () => {
  if (!hasClipboard.value) return
  if (copyInProgress.value) {
    ElMessage.info('正在复制，请稍候…')
    return
  }
  const src = clipboard.value.path
  const isDir = !!clipboard.value.isDir
  const mode = clipboard.value.mode
  const dstDir = getActiveDir()
  const name = basename(src)
  if (!name) return
  // 禁止将目录粘贴/移动到其自身或子目录
  if (mode === 'cut' && isDir && (dstDir === src || dstDir.startsWith(src + '/'))) {
    ElMessage.warning('无法移动到其自身或子目录内')
    return
  }
  const dst = `${dstDir}/${name}`
  try {
    if (mode === 'copy') {
      if (isDir) {
        // 复制目录：处理冲突策略
        let targetRootName = name
        if (await exists(dst)) {
          const choice = await chooseConflictForRoot(true, dstDir, name)
          if (choice.action === 'skip') return
          if (choice.action === 'rename' && choice.newName) {
            targetRootName = choice.newName
          }
          // 覆盖：沿用原名，采用“合并+覆盖文件”的策略
        }
        const targetRoot = `${dstDir}/${targetRootName}`
        await mkdirp(targetRoot)
        // 获取源目录树
        const treeRes = await window.api.fsTree({ subdir: src })
        if (!treeRes?.ok) return ElMessage.error(treeRes?.reason || '读取源目录失败')
        const rootBase = basename(src)
        // 优先使用基于 path 的扁平提取，确保拿到全部文件
        let files = flattenFilesFromTree(treeRes.tree, src)
        let dirs = []
        if (!files.length) {
          const ct = collectTree(treeRes.tree, rootBase)
          files = ct.files
          dirs = ct.dirs
        } else {
          // 从文件路径推导目录集合
          const set = new Set()
          for (const f of files) {
            const d = f.split('/').slice(0, -1).join('/')
            if (d) set.add(`${rootBase}/${d}`)
          }
          dirs = Array.from(set)
        }
        try { await log.info('目录复制收集结果：', { src, dirCount: dirs.length, fileCount: files.length, sampleDirs: dirs.slice(0, 3), sampleFiles: files.slice(0, 5) }) } catch {}
        if (!files.length) {
          ElMessage.warning('未发现可复制的文件，只创建了目录结构。')
          try { await log.warn('目录复制：files 为空，仅创建目录', { src }) } catch {}
        }
        if (files.length === 1) {
          try { await log.warn('目录复制：仅发现 1 个文件，可能是 fsTree 结构不完整', { src, only: files[0] }) } catch {}
        }
        // 先创建目录结构
        for (const d of dirs) {
          if (!d) continue
          const segs = String(d).split('/')
          const suffix = segs.length > 1 ? segs.slice(1).join('/') : ''
          const rel = suffix ? `${targetRoot}/${suffix}` : targetRoot
          if (rel) await mkdirp(rel)
        }
        // 写入文件（覆盖/跳过/重命名/逐个）+ 限流并发 + 进度
        const strategy = 'ask' // 固定为逐个询问模式（无批量策略弹窗）
        askApplyAll.value = false
        askChosenAction = null
        let askApplyAllPrompted = false
        const limiter = 1 // 暂时改为严格顺序，便于定位问题
        startCopyProgress(files.length)
        try { await log.info('开始顺序复制文件，总数：', files.length) } catch {}
        for (const relSrc of files) {
          try {
            if (!relSrc) { incCopyProgress(); continue }
            // relSrc 已经是相对 src 的子路径，直接使用
            const child = String(relSrc)
            if (!child) { incCopyProgress(); continue }
            const relSrcAbs = `${src}/${child}`
            const relDstBase = `${targetRoot}/${child}`
            const dstDirPath = relDstBase.split('/').slice(0, -1).join('/')
            const fileName = relDstBase.split('/').pop()
            // 冲突处理
            let finalDst = relDstBase
            if (await exists(relDstBase)) {
              if (strategy === 'ask') {
                let action = askApplyAll.value && askChosenAction ? askChosenAction : null
                if (!action) {
                  const c = await chooseConflictForRoot(false, dstDirPath, fileName)
                  if (c.action === 'skip') { incCopyProgress(); continue }
                  if (c.action === 'rename' && c.newName) {
                    finalDst = `${dstDirPath}/${c.newName}`
                    if (!askApplyAllPrompted) { await confirmApplyAllForAsk('重命名'); askApplyAllPrompted = askApplyAll.value }
                  } else if (c.action === 'overwrite') {
                    if (!askApplyAllPrompted) { await confirmApplyAllForAsk('覆盖'); askApplyAllPrompted = askApplyAll.value }
                  }
                  action = c.action
                }
                if (action === 'skip') { incCopyProgress(); continue }
                if (action === 'rename' && finalDst === relDstBase) {
                  const unique = await ensureUniquePath(dstDirPath, fileName)
                  finalDst = unique
                }
              } else if (strategy === 'skip') {
                incCopyProgress();
                continue
              } else if (strategy === 'rename') {
                const unique = await ensureUniquePath(dstDirPath, fileName)
                finalDst = unique
              }
            }
            // 确保目标目录存在
            if (dstDirPath) await mkdirp(dstDirPath)
            try { await log.info('复制文件：', { from: relSrcAbs, to: finalDst }) } catch {}
            const r = await window.api.fsReadFile({ relativePath: relSrcAbs })
            if (!r?.ok) { ElMessage.error(r?.reason || `读取失败：${relSrcAbs}`); incCopyProgress(); continue }
            const w = await window.api.fsWriteFile({ relativePath: finalDst, content: r.content })
            if (!w?.ok) { ElMessage.error(w?.reason || `写入失败：${finalDst}`); incCopyProgress(); continue }
            incCopyProgress()
          } catch (e) {
            ElMessage.error(String(e?.message || e))
            incCopyProgress()
          }
        }
        endCopyProgress()
        try { await log.info('目录已复制：', src, '->', targetRoot) } catch {}
        ElMessage.success(`已复制到 ${targetRoot}`)
        await loadNotesList()
        contextMenuShow.value = false
        return
      }
      // 文件复制：冲突策略
      let targetName = name
      if (await exists(dst)) {
        const choice = await chooseConflictForRoot(false, dstDir, name)
        if (choice.action === 'skip') return
        if (choice.action === 'rename' && choice.newName) {
          // 若重名，依然做一次唯一化
          targetName = await ensureUniquePath(dstDir, choice.newName).then((p) => p.split('/').pop())
        }
        // 覆盖：沿用原名
      }
      const r = await window.api.fsReadFile({ relativePath: src })
      if (!r?.ok) return ElMessage.error(r?.reason || '读取源文件失败')
      const target = `${dstDir}/${targetName}`
      const w = await window.api.fsWriteFile({ relativePath: target, content: r.content })
      if (!w?.ok) return ElMessage.error(w?.reason || '写入目标失败')
      try { await log.info('已复制：', src, '->', target) } catch {}
      ElMessage.success(`已复制到 ${target}`)
      // 复制后自动打开目标文件（不再仅限 .md）
      currentFile.value = target
    } else if (mode === 'cut') {
      const mv = await window.api.fsRename({ from: src, to: dst })
      if (!mv?.ok) return ElMessage.error(mv?.reason || '移动失败')
      // 若当前打开文件被移动，更新路径
      if (!isDir && currentFile.value === src) {
        currentFile.value = dst
      }
      clearClipboard()
      ElMessage.success('已移动')
    }
    await loadNotesList()
  } catch (e) {
    ElMessage.error(String(e?.message || e))
  } finally {
    contextMenuShow.value = false
  }
}

// 动态禁用判断
const isRootNode = computed(() => !!contextNode.value && contextNode.value.path === 'notes')
const canRename = computed(() => !!contextNode.value && !isRootNode.value)
const canDelete = computed(() => !!contextNode.value && !isRootNode.value)
const canMove = computed(() => !!contextNode.value && !isRootNode.value)
const canCopy = computed(() => !!contextNode.value) // 文件/目录均可复制
const canCut = computed(() => !!contextNode.value && !isRootNode.value)
const canPasteHere = computed(() => {
  if (!hasClipboard.value) return false
  const dstDir = getActiveDir()
  const src = clipboard.value.path || ''
  if (!dstDir || !src) return false
  // 禁止将目录移动到其自身或子目录
  if (clipboard.value.mode === 'cut' && clipboard.value.isDir) {
    if (dstDir === src || dstDir.startsWith(src + '/')) return false
  }
  return true
})

// 文件面板空白区域右键：仅展示“新建笔记/新建文件夹”
const onPaneContextMenu = (event) => {
  try { event?.preventDefault?.() } catch {}
  contextNode.value = null
  contextBlank.value = true
  contextMenuX.value = event.clientX || 0
  contextMenuY.value = event.clientY || 0
  contextMenuShow.value = true
  nextTick(() => {
    try {
      const el = contextMenuRef.value
      if (!el) return
      const menuW = el.offsetWidth || 0
      const menuH = el.offsetHeight || 0
      const vw = document.documentElement.clientWidth || window.innerWidth || 0
      const vh = document.documentElement.clientHeight || window.innerHeight || 0
      const padding = 8
      const maxX = vw - menuW - padding
      const maxY = vh - menuH - padding
      contextMenuX.value = Math.max(padding, Math.min(contextMenuX.value, maxX))
      contextMenuY.value = Math.max(padding, Math.min(contextMenuY.value, maxY))
    } catch {}
  })
}
const readGitConfig = async () => {
  const owner = await window.api.settingsGet('gitOwner')
  const repo = await window.api.settingsGet('gitRepo')
  const br = await window.api.settingsGet('gitBranch')
  // 账号用 owner 作为凭据 key（与设置页保存一致）
  const account = owner?.ok && owner.value ? String(owner.value) : ''
  return {
    owner: owner?.ok ? owner.value || '' : '',
    repo: repo?.ok ? repo.value || '' : '',
    branch: br?.ok ? (String(br.value || 'main') || 'main') : 'main',
    account
  }

}

  // 用系统默认程序打开目标（文件或目录）
  const openWithSystemAt = async (path) => {
    try {
      if (!path) return
      const rel = String(path).replace(/^\/+|^\\+/, '')
      const r = await window.api?.fsOpenPath?.({ relativePath: rel })
      if (!r?.ok) {
        ElMessage.error(r?.reason || '打开失败')
      }
    } catch (e) {
      ElMessage.error(String(e?.message || e))
    } finally {
      contextMenuShow.value = false
    }
  }

  // 在系统文件管理器中显示并选中
  const revealInFolderAt = async (path) => {
    try {
      if (!path) return
      const rel = String(path).replace(/^\/+|^\\+/, '')
      const r = await window.api?.fsRevealInFolder?.({ relativePath: rel })
      if (!r?.ok) {
        ElMessage.error(r?.reason || '无法在资源管理器中显示')
      }
    } catch (e) {
      ElMessage.error(String(e?.message || e))
    } finally {
      contextMenuShow.value = false
    }
  }

// 强拉：以远端为准覆盖本地（危险操作）
const doForcePull = async () => {
  const { branch: br } = await readGitConfig()
  try {
    await ElMessageBox.confirm(
      `将以远端 origin/${br} 覆盖本地当前分支，未提交的改动将丢失。继续吗？`,
      '强拉（远端覆盖本地）',
      {
        confirmButtonText: '继续',
        cancelButtonText: '取消',
        type: 'warning'
      }
    )
  } catch {
    return
  }
  try {
    // 确保主进程已打开 Vault，以便设置 currentVaultDir
    let vd = vaultDir.value
    if (!vd) {
      const rvd = await window.api.settingsGet('vaultDir')
      if (rvd?.ok && rvd.value) vd = rvd.value
    }
    if (vd) {
      const opened = await window.api.openVault(vd)
      if (!opened?.ok) {
        ElMessage.error(opened?.reason || '无法打开本地库目录，请返回设置页重新选择')
        await log.error('强拉前打开 Vault 失败：', opened?.reason || '')
        return
      }
    }
    // 优先尝试主进程提供的强制操作 API
    if (window.api?.gitForceResetToRemote) {
      const r = await window.api.gitForceResetToRemote({ branch: br })
      if (r?.ok) {
        ElMessage.success('已强制同步到远端最新')
        try { await log.info('强拉完成：已重置到 origin/' + br) } catch {}
        try { await loadNotesList?.() } catch {}
        return
      } else {
        // 有接口但失败，展示原因
        const reason = r?.reason ? String(r.reason) : '未知原因'
        await log.warn('强拉失败：', reason)
        await ElMessageBox.alert(`强拉失败：${reason}`, '执行失败', { confirmButtonText: '知道了' })
        return
      }
    }
    // 回退：给出命令指引
    const cmd = `git fetch\ngit reset --hard origin/${br}`
    await ElMessageBox.alert(
      `未检测到内置强制操作接口。请在仓库目录执行：\n\n${cmd}`,
      '请在终端执行',
      { confirmButtonText: '知道了' }
    )
  } catch (e) {
    ElMessage.error(String(e?.message || e))
  }
}

// 强推：以本地为准覆盖远端（危险操作）
const doForcePush = async () => {
  const { owner, repo, branch: br, account } = await readGitConfig()
  try {
    await ElMessageBox.confirm(
      `将以本地当前分支强制覆盖远端 origin/${br}，远端历史可能被改写。继续吗？`,
      '强推（本地覆盖远端）',
      {
        confirmButtonText: '继续',
        cancelButtonText: '取消',
        type: 'warning'
      }
    )
  } catch {
    return
  }
  try {
    // 确保主进程已打开 Vault，以便设置 currentVaultDir
    let vd = vaultDir.value
    if (!vd) {
      const rvd = await window.api.settingsGet('vaultDir')
      if (rvd?.ok && rvd.value) vd = rvd.value
    }
    if (vd) {
      const opened = await window.api.openVault(vd)
      if (!opened?.ok) {
        ElMessage.error(opened?.reason || '无法打开本地库目录，请返回设置页重新选择')
        await log.error('强推前打开 Vault 失败：', opened?.reason || '')
        return
      }
    }
    // 优先尝试主进程提供的强制操作 API
    if (window.api?.gitForcePush) {
      const r = await window.api.gitForcePush({ owner, repo, branch: br, account })
      if (r?.ok) {
        ElMessage.success('已强制推送到远端')
        try { await log.info('强推完成：origin/' + br) } catch {}
        return
      } else {
        const reason = r?.reason ? String(r.reason) : '未知原因'
        await log.warn('强推失败：', reason)
        await ElMessageBox.alert(`强推失败：${reason}`,'执行失败',{ confirmButtonText: '知道了' })
        return
      }
    }
    // 回退：给出命令指引（注意 Gitee 100MB 限制）
    const cmd = `git push --force origin ${br}`
    await ElMessageBox.alert(
      `未检测到内置强制操作接口。请在仓库目录执行：\n\n${cmd}\n\n若遇到 Gitee 提示单文件超过 100MB，需要先清理历史中的大文件后再推送。`,
      '请在终端执行',
      { confirmButtonText: '知道了' }
    )
  } catch (e) {
    ElMessage.error(String(e?.message || e))
  }
}

// 读取与持久化预览主题
onMounted(async () => {
  try {
    const r = await window.api.settingsGet(THEME_KEY)
    const t = r?.ok && r.value ? String(r.value).toLowerCase() : 'github'
    editorTheme.value = validThemes.includes(t) ? t : 'github'
    await log.debug('已读取编辑器主题：', editorTheme.value)
  } catch {}
})

watch(editorTheme, (val) => {
  try {
    const t = validThemes.includes(val) ? val : 'github'
    window.api.settingsSet(THEME_KEY, t)
      ?.then((r) => {
        if (r?.ok) log.info('已保存编辑器主题：', t)
        else log.warn('保存编辑器主题失败：', r?.reason || '')
      })
      ?.catch((e) => log.warn('保存编辑器主题异常：', String(e?.message || e)))
  } catch {}
})

// ================
// 未保存变更离开拦截（当自动保存关闭时）
// ================
// 判断是否存在“未保存变更”
// 说明：无论是否开启自动保存，只要当前文本与最近一次保存内容不一致，就视为未保存，避免在关闭时丢失更改
const hasUnsavedChanges = () => {
  return !!currentFile.value && editorText.value !== lastSavedText.value
}

// 二次确认：离开前提示是否保存
const confirmBeforeLeave = async (context = '离开当前页面') => {
  if (!hasUnsavedChanges()) return true
  await log.warn(`检测到未保存更改，准备${context}，弹出二次确认`)
  try {
    // 使用 MessageBox.confirm：确认=保存，取消=不保存，关闭=取消离开
    const isExit = /退出|关闭/.test(String(context))
    await ElMessageBox.confirm(
      isExit
        ? '检测到当前文件有未保存的更改，是否保存后退出应用？'
        : '检测到当前文件有未保存的更改，是否保存后继续？',
      '未保存更改',
      {
        confirmButtonText: isExit ? '保存并退出' : '保存并继续',
        cancelButtonText: isExit ? '直接退出' : '不保存',
        distinguishCancelAndClose: true,
        type: 'warning',
        closeOnClickModal: false
      }
    )
    await saveCurrent({ silent: true })
    await log.info('二次确认：已保存并继续')
    return true
  } catch (action) {
    if (action === 'cancel') {
      await log.info('二次确认：选择不保存并继续/退出')
      return true
    }
    // 关闭对话框（close/esc）视为取消离开
    await log.info('二次确认：已取消离开操作')
    return false
  }
}

// 轻量化保存提示文案与样式（显示在自动保存开关旁）
const saveHint = computed(() => {
  if (!autoSave.value) return '自动保存已关'
  switch (saveStatus.value) {
    case 'saving':
      return '正在保存…'
    case 'saved':
      return saveAt.value ? `已自动保存 ${saveAt.value}` : '已自动保存'
    case 'dirty':
      return '有未保存更改'
    default:
      return ''
  }
})
const saveHintClass = computed(() => {
  if (!autoSave.value) return 'hint-muted'
  if (saveStatus.value === 'dirty') return 'hint-dirty'
  if (saveStatus.value === 'saving') return 'hint-saving'
  if (saveStatus.value === 'saved') return 'hint-saved'
  return 'hint-muted'
})

// 搜索关键字（用于在左侧文件列表中过滤）
const searchKeyword = ref('')
// 是否启用全文检索（开启后将在笔记内容中检索并显示命中数）
const searchModeFull = ref(false)
// 全文检索命中数：key 为文件 path，value 为命中次数
const contentHits = ref({})

// 显示用：当前库的末级目录名（悬停展示完整路径）
const vaultDisplay = computed(() => {
  const s = String(vaultDir.value || '')
  if (!s) return '未选择（请前往设置页）'
  const arr = s.split(/\\|\//)
  return arr[arr.length - 1] || s
})

// 左侧面板可拖拽宽度（默认 280px）
const sidebarWidth = ref(280)
const isResizing = ref(false)
let _resizeStartX = 0
let _resizeStartW = 280
// 约束宽度到合理区间
const _clampSidebar = (w) => Math.min(Math.max(Math.round(w || 280), 200), 600)
// 开始拖拽
const onResizeStart = (e) => {
  try {
    isResizing.value = true
    _resizeStartX = e.clientX
    _resizeStartW = sidebarWidth.value
    // 监听全局 mousemove / mouseup，保证顺滑拖拽
    window.addEventListener('mousemove', onResizing)
    window.addEventListener('mouseup', onResizeEnd)
  } catch {}
}
// 拖拽中
const onResizing = (e) => {
  if (!isResizing.value) return
  try {
    const dx = e.clientX - _resizeStartX
    const next = Math.min(Math.max(_resizeStartW + dx, 200), 600) // 限制最小/最大宽度
    sidebarWidth.value = next
  } catch {}
}
// 结束拖拽
const onResizeEnd = () => {
  if (!isResizing.value) return
  isResizing.value = false
  try {
    window.removeEventListener('mousemove', onResizing)
    window.removeEventListener('mouseup', onResizeEnd)
    // 持久化保存侧栏宽度
    const w = _clampSidebar(sidebarWidth.value)
    sidebarWidth.value = w
    window.api?.settingsSet?.('notesSidebarWidth', w)
      ?.then((r) => {
        if (r?.ok) log.info('已保存侧栏宽度：', w)
        else log.warn('保存侧栏宽度失败：', r?.reason || '')
      })
      .catch((e) => log.warn('保存侧栏宽度异常：', String(e?.message || e)))
  } catch {}
}

onUnmounted(() => {
  if (typeof window !== 'undefined') {
    try {
      window.removeEventListener('mousedown', onGlobalPointerDown)
      window.removeEventListener('keydown', onKeydownClose)
    } catch {}
  }
  // 组件卸载时移除拖拽监听，防止泄漏
  try {
    window.removeEventListener('mousemove', onResizing)
    window.removeEventListener('mouseup', onResizeEnd)
  } catch {}
  // 组件卸载时清理自动保存定时器
  try {
    if (_autoSaveTimer) clearTimeout(_autoSaveTimer)
  } catch {}
  // 卸载 beforeunload 监听，避免内存泄漏
  try {
    const h = window.__notesBeforeUnload__
    if (h) {
      window.removeEventListener('beforeunload', h)
      delete window.__notesBeforeUnload__
    }
  } catch {}
})

// 路由离开守卫：当自动保存关闭且有未保存变更时，提示是否保存
onBeforeRouteLeave(async () => {
  const ok = await confirmBeforeLeave('离开笔记页面')
  if (!ok) {
    await log.info('路由离开被用户取消（未保存变更）')
  }
  return ok
})
// 窗口关闭与刷新拦截：
// - 主进程通过 IPC 请求退出确认（onConfirmQuit）；
// - 渲染进程通过 beforeunload 在刷新/关闭标签页时触发系统原生确认对话框。
onMounted(() => {
  // 主进程退出确认回调：返回 true 允许退出；false 取消
  try {
    window.api?.onConfirmQuit?.(async () => {
      await log.info('收到主进程退出确认请求，检查是否存在未保存变更')
      const ok = await confirmBeforeLeave('退出应用')
      await log.info('退出确认结果：', ok ? '允许' : '取消')
      return ok
    })
  } catch (e) {
    log.warn('注册退出确认回调失败：', String(e?.message || e))
  }

  // 刷新/关闭窗口：使用浏览器原生 beforeunload 提示（不可自定义文案）
  try {
    const handler = (e) => {
      try {
        if (hasUnsavedChanges()) {
          log.warn('beforeunload：检测到未保存更改，阻止默认并提示系统原生确认')
          e.preventDefault()
          e.returnValue = ''
          return ''
        }
      } catch {}
      return undefined
    }
    window.addEventListener('beforeunload', handler)
    // 挂到 window 便于卸载时移除
    window.__notesBeforeUnload__ = handler
  } catch (e) {
    log.warn('注册 beforeunload 失败：', String(e?.message || e))
  }
})
// 全文检索进行中指示
const searching = ref(false)

// 只读预览：当前文件命中片段集合与当前高亮索引
const previewSnippets = ref([]) // 每项：{ html: string }

// 新建文件夹：在 notes/ 下创建目录
const newFolder = async () => {
  if (!vaultDir.value) {
    ElMessage.error('请先选择本地库目录（在设置向导中选择）')
    await log.warn('新建文件夹失败：未选择 Vault')
    return
  }
  // 保险：确保主进程已打开当前 Vault
  const opened = await window.api.openVault(vaultDir.value)
  if (!opened?.ok) {
    ElMessage.error(opened?.reason || '无法打开本地库目录，请返回设置页重新选择')
    await log.error('打开 Vault 失败（新建文件夹时）：', opened?.reason || '')
    return
  }
  let name = ''
  try {
    const { value } = await ElMessageBox.prompt('输入新建文件夹名称（不含路径）', '新建文件夹', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      inputPlaceholder: 'new-folder',
      inputPattern: /^(?!\s*$).+/,
      inputErrorMessage: '名称不能为空'
    })
    name = value
  } catch {
    return
  }
  const baseDir = getActiveDir()
  const path = `${baseDir}/${name}`
  const res = await window.api.fsMkdir({ relativePath: path })
  if (res?.ok) {
    await loadNotesList()
    ElMessage.success('已创建文件夹')
    await log.info('已创建文件夹：', path)
  } else {
    ElMessage.error(res?.reason || '创建文件夹失败')
    await log.error('新建文件夹失败：', res?.reason || '')
  }
}
const activeMatchIndex = ref(0)

// Git 同步所需的最小字段（从持久化设置读取，设置页负责保存）
const gitOwner = ref('')
const gitRepo = ref('notes')
const gitBranch = ref('main')
const commitMsg = ref('update notes')
const syncing = ref(false)
const gitUserName = ref('')
const gitUserEmail = ref('')

// 加载 notes/ 目录树，并同步构建扁平文件列表
const loadNotesList = async () => {
  if (!vaultDir.value) return
  await log.debug('开始加载树形列表，vault=', vaultDir.value)
  // 确保 notes/ 存在
  let listed = await window.api.fsList({ subdir: 'notes' })
  if (!listed?.ok) {
    try {
      await window.api.fsWriteFile({ relativePath: 'notes/.gitkeep', content: '' })
      listed = await window.api.fsList({ subdir: 'notes' })
    } catch (e) {
      await log.warn('创建 notes/.gitkeep 失败：', String(e?.message || e))
    }
  }
  // 拉取递归树
  const res = await window.api.fsTree({ subdir: 'notes' })
  if (!res?.ok) {
    await log.error('加载目录树失败：', res?.reason || '')
    return
  }
  const raw = Array.isArray(res.tree) ? res.tree : []
  const convert = (nodes) =>
    nodes.map((n) => ({
      label: n.name,
      name: n.name,
      path: n.path.startsWith('notes/') ? n.path : `notes/${n.path}`,
      isDir: !!n.isDir,
      children: n.children ? convert(n.children) : []
    }))
  const built = convert(raw)
  treeData.value = built
  // 构建扁平文件数组（仅文件）供全文检索使用
  const flat = []
  const walk = (arr) => {
    for (const x of arr) {
      if (x.isDir) walk(x.children || [])
      else flat.push({ name: x.name, path: x.path, isDir: false })
    }
  }
  walk(built)
  files.value = flat
  await log.info('目录树已加载：根节点数=', built.length, '文件数=', flat.length)
}

// 计算属性：按关键字过滤文件列表
// - 文件名模式：仅匹配文件名
// - 全文模式：优先使用 contentHits 过滤并按命中数倒序
const filteredFiles = computed(() => {
  const kw = (searchKeyword.value || '').trim().toLowerCase()
  if (!kw) return files.value
  if (!searchModeFull.value) {
    return files.value.filter((f) => f.name.toLowerCase().includes(kw))
  }
  const hits = contentHits.value || {}
  return files.value
    .filter((f) => (hits[f.path] || 0) > 0)
    .sort((a, b) => (hits[b.path] || 0) - (hits[a.path] || 0))
})

// 防抖记录搜索关键字变化，避免频繁日志
let _searchLogTimer = null
watch(searchKeyword, (val) => {
  try {
    if (_searchLogTimer) clearTimeout(_searchLogTimer)
  } catch {}
  _searchLogTimer = setTimeout(() => {
    log.info('搜索关键字变更：', (val || '').trim() || '(空)')
  }, 300)
})

// 工具：统计子串在文本中出现的次数（大小写不敏感已由调用方处理）
const _countOccurrences = (text, needle) => {
  if (!text || !needle) return 0
  let cnt = 0
  let idx = 0
  while (true) {
    idx = text.indexOf(needle, idx)
    if (idx === -1) break
    cnt++
    idx += needle.length || 1
  }
  return cnt
}

// 全文检索：防抖执行，逐个读取文件内容并统计命中次数
let _contentSearchTimer = null
const _runContentSearch = async () => {
  const kw = (searchKeyword.value || '').trim().toLowerCase()
  if (!searchModeFull.value || !kw) {
    contentHits.value = {}
    return
  }
  try {
    searching.value = true
    await log.info('开始全文检索，关键字：', kw)
    const hits = {}
    // 顺序读取避免高并发造成主进程压力；文件一般不大足够应对
    for (const f of files.value) {
      // 仅对文件执行内容检索，目录跳过
      if (f?.isDir) continue
      try {
        const r = await window.api.fsReadFile({ relativePath: f.path })
        if (r?.ok) {
          const text = String(r.content || '')
          const cnt = _countOccurrences(text.toLowerCase(), kw)
          if (cnt > 0) hits[f.path] = cnt
        }
      } catch (e) {
        // 忽略单文件错误，但记录日志
        await log.warn('全文检索读取失败：', f.path, String(e?.message || e))
      }
    }
    contentHits.value = hits
    await log.info('全文检索完成，命中文件数：', Object.keys(hits).length)
  } finally {
    searching.value = false
  }
}

watch([searchKeyword, searchModeFull, files], () => {
  try {
    if (_contentSearchTimer) clearTimeout(_contentSearchTimer)
  } catch {}
  _contentSearchTimer = setTimeout(_runContentSearch, 350)
})

// ================
// 文件名高亮渲染（根据搜索关键字，大小写不敏感）
// ================
const _escapeHtml = (s) => {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

const renderName = (name) => {
  const kw = (searchKeyword.value || '').trim()
  if (!kw) return _escapeHtml(name)
  // 构造安全正则（转义特殊字符）
  const esc = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(esc, 'gi')
  const parts = String(name).split(re)
  const matches = String(name).match(re)
  if (!matches) return _escapeHtml(name)
  // 组装为高亮片段
  let html = ''
  for (let i = 0; i < parts.length; i++) {
    html += _escapeHtml(parts[i])
    if (i < parts.length - 1) {
      const m = matches[i]
      html += `<span class="bg-yellow-100 text-yellow-800">${_escapeHtml(m)}</span>`
    }
  }
  return html
}

// ================
// 当前文件内容命中片段预览（不影响编辑器，仅渲染只读片段）
// ================
const _buildPreviewSnippets = () => {
  const kw = (searchKeyword.value || '').trim()
  if (!searchModeFull.value || !kw || !editorText.value) {
    previewSnippets.value = []
    activeMatchIndex.value = 0
    return
  }
  // 记录构建预览日志（防止刷屏，仅关键动作）
  log.info('构建当前文件命中片段预览')
  const text = String(editorText.value)
  // 使用大小写不敏感匹配
  const esc = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(esc, 'gi')
  const snippets = []
  let m
  const ctx = 40 // 片段左右上下文长度
  while ((m = re.exec(text)) !== null) {
    const start = Math.max(0, m.index - ctx)
    const end = Math.min(text.length, m.index + m[0].length + ctx)
    const seg = text.slice(start, end)
    // 将 seg 中的命中再高亮（需转义）
    const segEsc = _escapeHtml(seg)
    // 为了在片段内仅高亮实际关键字，重建片段级正则
    const segHtml = segEsc.replace(
      new RegExp(esc, 'gi'),
      (t) => `<mark class=\"bg-yellow-100 text-yellow-800\">${_escapeHtml(t)}</mark>`
    )
    // 记录匹配在全文中的实际位置，便于外部定位到编辑器中
    const matchStart = m.index
    const matchEnd = m.index + (m[0]?.length || 0)
    snippets.push({
      html: (start > 0 ? '…' : '') + segHtml + (end < text.length ? '…' : ''),
      start: matchStart,
      end: matchEnd
    })
  }
  previewSnippets.value = snippets
  activeMatchIndex.value = 0
}

// 监听内容、关键字、模式与当前文件变化来重建预览（防抖）
let _previewTimer = null
watch([editorText, searchKeyword, searchModeFull, currentFile], () => {
  try {
    if (_previewTimer) clearTimeout(_previewTimer)
  } catch {}
  _previewTimer = setTimeout(_buildPreviewSnippets, 200)
})

// 预览交互：上一条/下一条/点击跳转（仅切换高亮，不改变编辑器光标）
const hasPreview = computed(
  () =>
    searchModeFull.value && (searchKeyword.value || '').trim() && previewSnippets.value.length > 0
)
const prevMatch = () => {
  if (!hasPreview.value) return
  activeMatchIndex.value =
    (activeMatchIndex.value - 1 + previewSnippets.value.length) % previewSnippets.value.length
  log.info('预览：上一条，索引=', activeMatchIndex.value)
}
const nextMatch = () => {
  if (!hasPreview.value) return
  activeMatchIndex.value = (activeMatchIndex.value + 1) % previewSnippets.value.length
  log.info('预览：下一条，索引=', activeMatchIndex.value)
}
const onSnippetClick = (idx) => {
  if (!hasPreview.value) return
  activeMatchIndex.value = idx
  const sn = previewSnippets.value[idx]
  if (sn && typeof sn.start === 'number') {
    // 在编辑器中选中命中范围并聚焦
    try {
      mdRef.value?.setSelection?.(sn.start, sn.end ?? sn.start)
      mdRef.value?.focus?.()
      log.info('预览：点击定位并高亮命中，索引=', activeMatchIndex.value, '范围=', sn.start, sn.end)
    } catch (e) {
      log.warn('预览：定位失败', String(e?.message || e))
    }
  } else {
    log.info('预览：点击定位，索引=', activeMatchIndex.value)
  }
}

// 打开指定文件到编辑器
const openFile = async (path) => {
  await log.debug('打开文件：', path)
  const res = await window.api.fsReadFile({ relativePath: path })
  if (res?.ok) {
    currentFile.value = path
    editorText.value = res.content ?? ''
    // 记录加载时的内容，避免“打开后首次 watch 立即保存”
    lastSavedText.value = editorText.value
    saveStatus.value = 'saved'
    try {
      const t = new Date();
      saveAt.value = `${t.getHours().toString().padStart(2,'0')}:${t.getMinutes().toString().padStart(2,'0')}:${t.getSeconds().toString().padStart(2,'0')}`
    } catch {}
    await log.info('文件已打开：', path)
  } else {
    ElMessage.error(res?.reason || '读取失败')
    await log.error('读取文件失败：', path, res?.reason || '')
  }
}

// 列表项点击：目录与文件区分处理（树节点）
const onItemClick = async (f) => {
  if (!f) return
  if (f.isDir) {
    // 暂不支持展开子目录，仅提示
    // 改为树形后，点击目录只记录选中（展开/折叠由 el-tree 控制）
    selectedNode.value = f
    await log.info('选择目录：', f.path)
    return
  }
  // 如果切换到另一个文件，先进行未保存拦截
  if (f.path !== currentFile.value) {
    const ok = await confirmBeforeLeave('切换到其它文件')
    if (!ok) return
  }
  selectedNode.value = f
  await openFile(f.path)
}

// 树节点点击（el-tree 原生事件）
const onNodeClick = (data) => {
  onItemClick(data)
}

// 右键菜单：在树节点上打开上下文菜单
const onNodeContextMenu = (event, data, node) => {
  try {
    event?.preventDefault?.()
  } catch {}
  selectedNode.value = data
  contextNode.value = data
  contextBlank.value = false
  // position: fixed 使用 clientX/clientY
  contextMenuX.value = event.clientX || 0
  contextMenuY.value = event.clientY || 0
  contextMenuShow.value = true
  nextTick(() => {
    try {
      const el = contextMenuRef.value
      if (!el) return
      const menuW = el.offsetWidth || 0
      const menuH = el.offsetHeight || 0
      const vw = document.documentElement.clientWidth || window.innerWidth || 0
      const vh = document.documentElement.clientHeight || window.innerHeight || 0
      const padding = 8
      const maxX = vw - menuW - padding
      const maxY = vh - menuH - padding
      contextMenuX.value = Math.max(padding, Math.min(contextMenuX.value, maxX))
      contextMenuY.value = Math.max(padding, Math.min(contextMenuY.value, maxY))
    } catch {}
  })
  log.info('右键菜单：目标=', data?.path)
}

// 隐藏右键菜单（手动调用）
const hideContextMenu = () => {
  contextMenuShow.value = false
}

// 全局指针按下：仅左键且点击在菜单外时关闭菜单
const onGlobalPointerDown = (e) => {
  try {
    if (!contextMenuShow.value) return
    // 右键（button===2）不处理，避免在触发 contextmenu 后立即关闭
    if (e?.button === 2) return
    const el = contextMenuRef.value
    if (el && el.contains?.(e?.target)) return
    contextMenuShow.value = false
  } catch {}
}

// 启动“移动到”对话框
const moveDialogVisible = ref(false)
const moveSourcePath = ref('')
const moveTargetDir = ref('notes')
// 仅目录树（供选择目标目录）
const dirOnlyTree = computed(() => {
  const filterDir = (arr) =>
    (arr || [])
      .filter((n) => n.isDir)
      .map((n) => ({
        label: n.label,
        name: n.name,
        path: n.path,
        isDir: true,
        children: filterDir(n.children || [])
      }))
  return filterDir(treeData.value)
})
const openMoveDialog = (srcPath) => {
  moveSourcePath.value = srcPath
  moveTargetDir.value = (srcPath || 'notes').split('/').slice(0, -1).join('/') || 'notes'
  moveDialogVisible.value = true
  log.info('打开“移动到”对话框：', srcPath)
}
const onMoveDirSelected = (data) => {
  if (data?.isDir) moveTargetDir.value = data.path
}
const confirmMoveTo = async () => {
  const src = moveSourcePath.value
  const dstDir = moveTargetDir.value || 'notes'
  const name = (src || '').split('/').pop()
  if (!src || !name) return
  // 防止移动到自身或子目录
  if (dstDir === src || dstDir.startsWith(src + '/')) {
    ElMessage.warning('无法移动到其自身或子目录内')
    return
  }
  const dst = `${dstDir}/${name}`
  if (dst === src) {
    moveDialogVisible.value = false
    return
  }
  const res = await window.api.fsRename({ from: src, to: dst })
  if (res?.ok) {
    await log.info('移动完成：', src, '->', dst)
    await loadNotesList()
    if (currentFile.value === src) currentFile.value = dst
    ElMessage.success('已移动')
  } else {
    await log.error('移动失败：', res?.reason || '')
    ElMessage.error(res?.reason || '移动失败')
  }
  moveDialogVisible.value = false
}

// 获取当前操作的目标目录路径：已在顶部实现 getActiveDir（包含右键上下文与当前文件回退）

// 新建笔记：创建 Markdown 文件并打开
const newNote = async () => {
  if (!vaultDir.value) {
    ElMessage.error('请先选择本地库目录（在设置向导中选择）')
    await log.warn('新建笔记失败：未选择 Vault')
    return
  }
  // 保险：确保主进程已打开当前 Vault
  const opened = await window.api.openVault(vaultDir.value)
  if (!opened?.ok) {
    ElMessage.error(opened?.reason || '无法打开本地库目录，请返回设置页重新选择')
    await log.error('打开 Vault 失败：', opened?.reason || '')
    return
  }
  let name = ''
  try {
    const { value } = await ElMessageBox.prompt(
      '输入新笔记文件名（不含路径，自动加 .md）',
      '新建笔记',
      {
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        inputPlaceholder: 'new-note',
        inputPattern: /^(?!\s*$).+/,
        inputErrorMessage: '文件名不能为空'
      }
    )
    name = value
  } catch {
    return // 用户取消
  }
  const safe = String(name).endsWith('.md') ? String(name) : `${name}.md`
  const baseDir = getActiveDir()
  const path = `${baseDir}/${safe}`
  const initial = `---\ntitle: ${safe.replace(
    '.md',
    ''
  )}\ncreated: ${new Date().toISOString()}\n---\n\n# ${safe.replace('.md', '')}\n\n`
  const res = await window.api.fsWriteFile({ relativePath: path, content: initial })
  if (res?.ok) {
    await loadNotesList()
    await openFile(path)
    ElMessage.success('已创建新笔记')
    await log.info('已创建新笔记：', path)
  } else {
    ElMessage.error(res?.reason || '创建失败')
    await log.error('新建笔记失败：', res?.reason || '')
  }
}

// 保存当前编辑器内容到文件，返回 boolean 表示是否成功
const saveCurrent = async (opts = {}) => {
  // opts.silent: 是否静默（不弹出全局提示，用于自动保存）
  if (!currentFile.value) {
    ElMessage.info('没有打开的文件')
    await log.warn('保存跳过：未打开文件')
    return false
  }
  // 保险：确保主进程已打开当前 Vault
  if (vaultDir.value) {
    const opened = await window.api.openVault(vaultDir.value)
    if (!opened?.ok) {
      ElMessage.error(opened?.reason || '无法打开本地库目录，请返回设置页重新选择')
      await log.error('打开 Vault 失败（保存时）：', opened?.reason || '')
      return false
    }
  }
  const res = await window.api.fsWriteFile({
    relativePath: currentFile.value,
    content: editorText.value
  })
  if (res?.ok) {
    if (!opts?.silent) {
      ElMessage.success('已保存')
    }
    await log.info('已保存文件：', currentFile.value)
    // 更新最近一次保存内容
    lastSavedText.value = editorText.value
    saveStatus.value = 'saved'
    try {
      const t = new Date();
      saveAt.value = `${t.getHours().toString().padStart(2,'0')}:${t.getMinutes().toString().padStart(2,'0')}:${t.getSeconds().toString().padStart(2,'0')}`
    } catch {}
    return true
  } else {
    ElMessage.error(`保存失败：${res?.reason || ''}`)
    await log.error('保存失败：', currentFile.value, res?.reason || '')
    return false
  }
}

// 处理应用层“保存并退出”请求
const onAppSaveAll = async () => {
  try {
    // 若有自动保存的定时器，提前清理，避免与手动保存竞争
    try { if (_autoSaveTimer) clearTimeout(_autoSaveTimer) } catch {}
    // 需要保存的条件：有打开文件，且内容不同步，或当前处于 saving/dirty
    const needSave = !!(
      currentFile.value && (
        editorText.value !== lastSavedText.value ||
        saveStatus.value === 'dirty' ||
        saveStatus.value === 'saving'
      )
    )
    let ok = true
    if (needSave) {
      saveStatus.value = 'saving'
      ok = await saveCurrent({ silent: true })
    }
    try { window.dispatchEvent(new CustomEvent('app:saveAll:done', { detail: { ok } })) } catch {}
  } catch (e) {
    try { await log.error('处理 app:saveAll 失败：', String(e?.message || e)) } catch {}
    try { window.dispatchEvent(new CustomEvent('app:saveAll:done', { detail: { ok: false, reason: String(e?.message || e) } })) } catch {}
  }
}

onMounted(() => {
  try { window.addEventListener('app:saveAll', onAppSaveAll) } catch {}
})

onUnmounted(() => {
  try { window.removeEventListener('app:saveAll', onAppSaveAll) } catch {}
})

// =================
// 自动保存（基于编辑内容变更，防抖 800ms）
// =================
watch(
  () => editorText.value,
  () => {
    // 清理上一次定时器，避免高频触发
    try {
      if (_autoSaveTimer) clearTimeout(_autoSaveTimer)
    } catch {}
    // 未开启、未打开文件或内容未变化则跳过
    if (!autoSave.value) return
    if (!currentFile.value) return
    if (editorText.value === lastSavedText.value) return
    // 标记为有未保存更改
    saveStatus.value = 'dirty'
    // 防抖执行保存
    _autoSaveTimer = setTimeout(async () => {
      saveStatus.value = 'saving'
      await log.info('自动保存触发：', currentFile.value)
      try {
        await saveCurrent({ silent: true })
      } catch (e) {
        await log.error('自动保存失败：', String(e?.message || e))
        // 失败后仍保持为 dirty，提示用户有未保存变更
        saveStatus.value = 'dirty'
      }
    }, 800)
  }
)

// Git 提交
// Git 提交：添加全部并提交
const doCommit = async () => {
  try {
    const ok = await ensureGitReady()
    if (!ok) return
    const res = await window.api.gitCommit({ message: commitMsg.value || 'update notes' })
    if (res?.ok) {
      ElMessage.success('已提交')
      await log.info('Git 提交成功：', commitMsg.value)
    } else {
      ElMessage.error(res?.reason || '提交失败')
      await log.error('Git 提交失败：', res?.reason || '')
    }
  } catch (e) {
    ElMessage.error(String(e?.message || e))
    await log.error('Git 提交异常：', String(e?.message || e))
  }
}

// Git 同步：先尝试提交（无改动则忽略），再 pull --rebase 后 push；必要时创建远程仓库
const doSync = async () => {
  // 回填并清洗（去空格）
  let owner = (gitOwner.value || '').trim()
  let repo = (gitRepo.value || '').trim()
  let branch = (gitBranch.value || '').trim()
  if (!owner || !repo) {
    try {
      const ro = await window.api.settingsGet('gitOwner')
      const rr = await window.api.settingsGet('gitRepo')
      const rb = await window.api.settingsGet('gitBranch')
      owner = (ro?.ok && ro.value ? ro.value : owner).trim()
      repo = (rr?.ok && rr.value ? rr.value : repo).trim()
      branch = (rb?.ok && rb.value ? rb.value : branch).trim()
    } catch {}
  }
  gitOwner.value = owner
  gitRepo.value = repo
  gitBranch.value = branch || 'main'
  if (!gitOwner.value || !gitRepo.value) {
    ElMessage.error('请先在设置向导填写 Gitee 用户名与仓库名')
    router.push('/setup')
    await log.warn('同步中断：缺少 owner/repo，跳转到设置页')
    return
  }
  try {
    syncing.value = true
    await log.info('开始同步：', {
      owner: gitOwner.value,
      repo: gitRepo.value,
      branch: gitBranch.value || 'main'
    })
    const ok = await ensureGitReady()
    if (!ok) return
    // 1) 先尝试提交（可能无改动）
    try {
      const cr = await window.api.gitCommit({ message: commitMsg.value || 'update notes' })
      if (cr?.ok) {
        await log.info('同步前已自动提交：', commitMsg.value)
      } else {
        const rsn = String(cr?.reason || '')
        // 忽略“无改动可提交”等非致命情况
        if (/nothing to commit|no changes|nothing added to commit/i.test(rsn)) {
          await log.debug('无改动可提交，直接进入同步')
        } else if (rsn) {
          await log.warn('自动提交失败（继续执行同步）：', rsn)
        }
      }
    } catch (e) {
      await log.warn('自动提交异常（继续执行同步）：', String(e?.message || e))
    }
    // 2) 执行 pull --rebase 后 push（账户名与 Owner 一致，用于从主进程取 PAT）
    const res = await window.api.gitPullPush({
      owner: gitOwner.value,
      repo: gitRepo.value,
      branch: gitBranch.value || 'main',
      account: gitOwner.value
    })
    if (res?.ok) {
      if (res.created) {
        ElMessage.success('已创建远程仓库并完成首次同步')
        await log.info('首次同步完成并创建远程仓库')
      } else {
        ElMessage.success('同步完成')
        await log.info('同步完成')
      }
    } else {
      ElMessage.error(res?.reason || '同步失败')
      await log.error('同步失败：', res?.reason || '')
    }
  } catch (e) {
    ElMessage.error(String(e?.message || e))
    await log.error('同步异常：', String(e?.message || e))
  } finally {
    syncing.value = false
  }
}

// 删除文件/目录
const deleteItem = async (path) => {
  // 二次确认
  try {
    await ElMessageBox.confirm(`确定删除：${path} ？`, '删除确认', {
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      type: 'warning'
    })
  } catch {
    return
  }
  // 保险：确保主进程已打开当前 Vault，否则删除可能无效
  if (!vaultDir.value) {
    ElMessage.error('尚未选择本地库目录，无法删除')
    await log.warn('删除中断：未选择 Vault')
    return
  }
  const opened = await window.api.openVault(vaultDir.value)
  if (!opened?.ok) {
    ElMessage.error(opened?.reason || '无法打开本地库目录，请返回设置页重新选择')
    await log.error('打开 Vault 失败（删除时）：', opened?.reason || '')
    return
  }
  // 执行删除（增加“删除中”提示）
  let loadingMsg
  try {
    loadingMsg = ElMessage({ message: '正在删除...', type: 'info', duration: 0 })
    const res = await window.api.fsDelete({ relativePath: path })
    if (res?.ok) {
      if (currentFile.value === path) {
        currentFile.value = ''
        editorText.value = ''
      }
      await loadNotesList()
      ElMessage.success('已删除')
      await log.info('已删除文件：', path)
    } else {
      ElMessage.error(res?.reason || '删除失败')
      await log.error('删除失败：', path, res?.reason || '')
    }
  } catch (e) {
    ElMessage.error(String(e?.message || e))
    await log.error('删除异常：', String(e?.message || e))
  } finally {
    try { loadingMsg?.close?.() } catch {}
  }
}

// 重命名：支持文件与目录（不再限制 .md 扩展）
const renameItem = async (path) => {
  const base = path.split('/').pop()
  // 判断是否目录（在已加载的一层列表中查找）
  // 先在树中查找，找不到再退回到扁平文件（默认为文件）
  const _findInTree = (arr) => {
    for (const n of arr) {
      if (n.path === path) return n
      if (n.isDir) {
        const m = _findInTree(n.children || [])
        if (m) return m
      }
    }
    return null
  }
  const item = _findInTree(treeData.value) || files.value.find((f) => f.path === path)
  const isDir = !!item?.isDir
  let newName = ''
  try {
    if (isDir) {
      // 目录重命名校验：非空且不包含斜杠
      const { value } = await ElMessageBox.prompt('重命名文件夹（仅名称，不含路径）', '重命名', {
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        inputValue: base,
        inputPattern: /^(?!\s*$)(?!.*[\\\/]).+$/,
        inputErrorMessage: '名称不能为空且不能包含斜杠'
      })
      newName = value
    } else {
      // 文件重命名：非空且不包含斜杠（不再限制后缀）
      const { value } = await ElMessageBox.prompt('重命名为（仅文件名，不含路径）', '重命名', {
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        inputValue: base,
        inputPattern: /^(?!\s*$)(?!.*[\\\/]).+$/,
        inputErrorMessage: '名称不能为空且不能包含斜杠'
      })
      newName = value
    }
  } catch {
    // 用户取消
    return
  }
  // 目标保持在原目录下
  const dir = dirname(path)
  const to = `${dir}/${newName}`
  // 若目标已存在，确认是否覆盖
  if (await exists(to)) {
    try {
      await ElMessageBox.confirm(`目标已存在：${to}，是否覆盖？`, '确认重命名覆盖', {
        confirmButtonText: '覆盖',
        cancelButtonText: '取消',
        type: 'warning'
      })
    } catch {
      return
    }
  }
  const res = await window.api.fsRename({ from: path, to })
  if (res?.ok) {
    await loadNotesList()
    if (!isDir && currentFile.value === path) currentFile.value = to
    ElMessage.success('已重命名')
    await log.info('已重命名：', isDir ? '[D]' : '[F]', path, '->', to)
  } else {
    ElMessage.error(res?.reason || '重命名失败')
    await log.error('重命名失败：', path, res?.reason || '')
  }
}

// 批量删除：基于勾选节点
const batchDelete = async () => {
  let loadingMsg
  try {
    // 保险：确保主进程已打开当前 Vault
    if (!vaultDir.value) {
      ElMessage.error('尚未选择本地库目录')
      await log.warn('批量删除中断：未选择 Vault')
      return
    }
    const opened = await window.api.openVault(vaultDir.value)
    if (!opened?.ok) {
      ElMessage.error(opened?.reason || '无法打开本地库目录')
      await log.error('批量删除：打开 Vault 失败：', opened?.reason || '')
      return
    }
    const nodes = treeRef.value?.getCheckedNodes?.() || []
    const targets = nodes.filter((n) => n && n.path)
    if (!targets.length) {
      ElMessage.info('请先勾选需要删除的项')
      return
    }
    await ElMessageBox.confirm(`确定删除选中的 ${targets.length} 项？`, '批量删除确认', {
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      type: 'warning'
    })
    // 显示批量删除 Loading 提示
    loadingMsg = ElMessage({ message: `正在批量删除（${targets.length} 项）...`, type: 'info', duration: 0 })
    for (const t of targets) {
      const r = await window.api.fsDelete({ relativePath: t.path })
      if (!r?.ok) {
        await log.warn('批量删除失败：', t.path, r?.reason || '')
      } else {
        await log.info('已删除：', t.path)
      }
    }
    await loadNotesList()
    ElMessage.success('批量删除完成')
  } catch (e) {
    if (e) await log.error('批量删除异常：', String(e?.message || e))
  } finally {
    try { loadingMsg?.close?.() } catch {}
  }
}

// 拖拽移动：计算目标路径并执行重命名
const allowDrop = (draggingNode, dropNode, type) => {
  // 仅允许：
  // - 放到目录内部（inner，且目标是目录）
  // - 放到文件/目录前后（before/after），相当于同级移动
  if (type === 'inner') return !!dropNode?.data?.isDir
  return true
}
const handleNodeDrop = async (draggingNode, dropNode, dropType) => {
  try {
    const src = draggingNode?.data?.path
    const name = src?.split('/').pop()
    if (!src || !name) return
    // 禁止将目录/文件拖入其自身或其子孙目录
    const dropPath = dropNode?.data?.path || 'notes'
    const targetDirForCheck =
      dropType === 'inner' ? dropPath : dropPath.split('/').slice(0, -1).join('/') || 'notes'
    if (targetDirForCheck === src || targetDirForCheck.startsWith(src + '/')) {
      ElMessage.warning('无法移动到其自身或子目录内')
      await log.warn('拖拽移动中断：目标为自身或子目录', { src, drop: dropPath, dropType })
      return
    }
    let dstDir = 'notes'
    if (dropType === 'inner') {
      dstDir = dropNode?.data?.path || 'notes'
    } else {
      const parent = (dropNode?.data?.path || 'notes').split('/').slice(0, -1).join('/') || 'notes'
      dstDir = parent
    }
    const dst = `${dstDir}/${name}`
    if (dst === src) return
    const res = await window.api.fsRename({ from: src, to: dst })
    if (res?.ok) {
      await log.info('拖拽移动成功：', src, '->', dst)
      await loadNotesList()
      // 若当前打开文件被移动，更新路径
      if (currentFile.value === src) currentFile.value = dst
    } else {
      await log.error('拖拽移动失败：', res?.reason || '')
      ElMessage.error(res?.reason || '移动失败')
    }
  } catch (e) {
    await log.error('拖拽移动异常：', String(e?.message || e))
  }
}

const router = useRouter()
onMounted(async () => {
  try {
    const v = await window.api.settingsGet('vaultDir')
    const o = await window.api.settingsGet('gitOwner')
    const r = await window.api.settingsGet('gitRepo')
    const b = await window.api.settingsGet('gitBranch')
    const u = await window.api.settingsGet('gitUserName')
    const e = await window.api.settingsGet('gitUserEmail')
    if (o?.ok && o.value) gitOwner.value = o.value
    if (r?.ok && r.value) gitRepo.value = r.value
    if (b?.ok && b.value) gitBranch.value = b.value
    if (u?.ok && u.value) gitUserName.value = u.value
    if (e?.ok && e.value) gitUserEmail.value = e.value
    const saved = v?.ok ? v.value : ''
    if (saved) {
      await log.debug('尝试打开 Vault：', saved)
      const opened = await window.api.openVault(saved)
      if (opened?.ok) {
        vaultDir.value = saved
        await loadNotesList()
        await log.info('Vault 已打开且列表已加载')
      } else {
        ElMessage.error(opened?.reason || '无法打开本地库目录，请重新选择')
        await log.error('打开 Vault 失败：', opened?.reason || '')
      }
    }
    // 读取并应用侧栏宽度（持久化）
    try {
      const sw = await window.api?.settingsGet?.('notesSidebarWidth')
      if (sw?.ok && sw.value) {
        const w = _clampSidebar(Number(sw.value))
        sidebarWidth.value = w
        await log.info('已应用持久化侧栏宽度：', w)
      }
    } catch (e) {
      await log.warn('读取侧栏宽度失败：', String(e?.message || e))
    }
  } catch {}
})

// 全局：左键点击菜单外时隐藏
if (typeof window !== 'undefined') {
  window.addEventListener('mousedown', onGlobalPointerDown)
}

// ESC 关闭菜单
const onKeydownClose = (e) => {
  try {
    if (e?.key === 'Escape' && contextMenuShow.value) contextMenuShow.value = false
  } catch {}
}
if (typeof window !== 'undefined') {
  window.addEventListener('keydown', onKeydownClose)
}

// 不在笔记页持久化 Git 配置，设置页为唯一来源，避免在此覆盖

// 确保 Git 就绪：若当前目录不是 Git 仓库则自动初始化
// 确保当前目录为 Git 仓库；若不是则初始化并配置
const ensureGitReady = async () => {
  if (!vaultDir.value) {
    ElMessage.error('尚未选择本地库目录')
    await log.warn('ensureGitReady 失败：未选择 Vault')
    return false
  }
  try {
    const st = await window.api.gitStatus()
    if (st?.ok) return true
  } catch {
    // 继续尝试初始化
  }
  try {
    const remote =
      gitOwner.value && gitRepo.value
        ? `https://gitee.com/${gitOwner.value}/${gitRepo.value}.git`
        : ''
    await log.debug('初始化 Git 仓库，remote=', remote || '(无)')
    const res = await window.api.gitInitOrClone({
      dir: vaultDir.value,
      remote,
      branch: gitBranch.value || 'main',
      user: gitUserName.value || undefined,
      email: gitUserEmail.value || undefined
    })
    if (!res?.ok) {
      ElMessage.error(res?.reason || '初始化 Git 仓库失败')
      await log.error('初始化 Git 失败：', res?.reason || '')
      return false
    }
    await log.info('Git 仓库已就绪')
    return true
  } catch (e) {
    ElMessage.error(String(e?.message || e))
    await log.error('初始化 Git 异常：', String(e?.message || e))
    return false
  }
}

// 预览主题切换
function onEditorThemeChange(v) {
  ElMessage.success('编辑器预览主题已切换为：' + v)
}

</script>

<template>
  <section class="card-cute">
    <div class="page-head">
      <div class="left">
        <el-icon class="app-logo"><Notebook /></el-icon>
        <el-tooltip :content="vaultDir || '未选择（请前往设置页）'" placement="top" :show-after="300">
          <span class="vault">当前库：{{ vaultDisplay }}</span>
        </el-tooltip>
      </div>
      <div class="right">
        <el-tooltip content="设置" placement="left">
          <el-button link circle :icon="Setting" size="small" @click="router.push('/setup')" />
        </el-tooltip>
      </div>
    </div>

    <div class="notes-layout" :class="{ dragging: isResizing }" :style="{ gridTemplateColumns: sidebarWidth + 'px 6px 1fr' }">
      <!-- 左侧：文件列表 -->
      <el-card shadow="never" class="file-pane">
        <!-- 搜索框独占一行 -->
        <div class="search-row">
          <el-input
            v-model="searchKeyword"
            placeholder="搜索文件名..."
            clearable
            size="small"
            class="w-full"
          >
            <template #prefix>
              <el-icon><Search /></el-icon>
            </template>
          </el-input>
        </div>
        <!-- 操作区（与搜索分行） -->
        <div class="pane-actions">
          <el-tooltip content="全文检索" placement="bottom">
            <el-switch v-model="searchModeFull" size="small" />
          </el-tooltip>
          <span v-if="searchModeFull && searching" class="tip-muted">检索中...</span>
          <div class="flex-1"></div>
          <el-tooltip content="刷新列表" placement="bottom">
            <el-button circle :icon="Refresh" @click="loadNotesList" />
          </el-tooltip>
          <el-tooltip content="新建文件夹" placement="bottom">
            <el-button circle :icon="FolderAdd" @click="newFolder" />
          </el-tooltip>
          <el-tooltip content="新建笔记" placement="bottom">
            <el-button type="primary" circle :icon="Plus" @click="newNote" />
          </el-tooltip>
          <el-tooltip content="批量删除（勾选后操作）" placement="bottom">
            <el-button size="small" :icon="DeleteIcon" @click="batchDelete" />
          </el-tooltip>
        </div>
        <el-scrollbar class="files-scroll" @contextmenu.prevent.stop="onPaneContextMenu">
          <el-tree
            ref="treeRef"
            :data="treeData"
            node-key="path"
            :props="{ label: 'label', children: 'children' }"
            show-checkbox
            highlight-current
            draggable
            :check-on-click-node="false"
            :allow-drop="allowDrop"
            @node-drop="handleNodeDrop"
            @node-click="onNodeClick"
            @node-contextmenu="onNodeContextMenu"
            :expand-on-click-node="false"
            class="notes-tree"
          >
            <template #default="{ data, node }">
              <!-- 点击文件名行时阻止事件冒泡，避免误触发复选框勾选；手动触发节点点击逻辑 -->
              <div
                class="tree-row"
                :class="{ active: currentFile === data.path }"
                @click.stop="onNodeClick(data)"
              >
                <Icon
                  class="mr-1"
                  :icon="getIconName(data.path, data.isDir, node?.expanded)"
                  width="18"
                  height="18"
                />
                <el-tooltip :content="data.path" placement="top" :show-after="300">
                  <span class="name" v-html="renderName(data.name)"></span>
                </el-tooltip>
                <span
                  v-if="!data.isDir && searchModeFull && (contentHits[data.path] || 0) > 0"
                  class="badge"
                >
                  {{ contentHits[data.path] }}
                </span>
              </div>
            </template>
          </el-tree>
        </el-scrollbar>
        <!-- 右键菜单（定位在鼠标处） -->
        <div
          v-show="contextMenuShow"
          class="context-menu"
          ref="contextMenuRef"
          :style="{ top: contextMenuY + 'px', left: contextMenuX + 'px' }"
          @click.stop
        >
          <div
            class="ctx-item"
            @click="
              () => {
                newNote()
                contextMenuShow = false
              }
            "
          >
            新建笔记
          </div>
          <div
            class="ctx-item"
            @click="
              () => {
                newFolder()
                contextMenuShow = false
              }
            "
          >
            新建文件夹
          </div>
          <div class="ctx-sep"></div>
          <div
            v-if="!contextBlank"
            class="ctx-item"
            :class="{ disabled: !canRename }"
            @click="
              () => {
                if (canRename) contextNode && renameItem(contextNode.path)
                contextMenuShow = false
              }
            "
          >
            重命名
          </div>
          <div
            v-if="!contextBlank"
            class="ctx-item text-red-600"
            :class="{ disabled: !canDelete }"
            @click="
              () => {
                if (canDelete) contextNode && deleteItem(contextNode.path)
                contextMenuShow = false
              }
            "
          >
            删除
          </div>
          <div
            v-if="!contextBlank"
            class="ctx-item"
            :class="{ disabled: !canMove }"
            @click="
              () => {
                if (canMove) contextNode && openMoveDialog(contextNode.path)
                contextMenuShow = false
              }
            "
          >
            移动到…
          </div>
          <div class="ctx-sep" v-if="!contextBlank"></div>
          <div
            v-if="!contextBlank"
            class="ctx-item"
            :class="{ disabled: !canCopy }"
            @click="() => canCopy && onCopy(contextNode)"
          >
            复制
          </div>
          <div
            v-if="!contextBlank"
            class="ctx-item"
            :class="{ disabled: !canCut }"
            @click="() => canCut && onCut(contextNode)"
          >
            剪切
          </div>
          <div
            class="ctx-item"
            :class="{ disabled: !canPasteHere }"
            @click="() => canPasteHere && onPaste()"
          >
            粘贴
          </div>
          <div class="ctx-sep"></div>
          <div
            v-if="!contextBlank"
            class="ctx-item"
            @click="() => contextNode && openWithSystemAt(contextNode.path)"
          >
            用系统打开
          </div>
          <div
            v-if="!contextBlank"
            class="ctx-item"
            @click="() => contextNode && revealInFolderAt(contextNode.path)"
          >
            在资源管理器中显示
          </div>
        </div>
      </el-card>

      <!-- 中间：垂直拖拽分隔条 -->
      <div class="v-resizer" @mousedown="onResizeStart" title="拖拽调整左侧宽度"></div>

      <!-- 右侧：编辑器（textarea 占位） -->
      <div class="editor-area">
        <!-- 顶部工具条（图标化） -->
        <div class="editor-toolbar">
          <div class="file-indicator">
            <el-icon><Document /></el-icon>
            <el-tooltip
              :content="currentFile"
              placement="top"
              :disabled="!currentFile"
              :show-after="300"
            >
              <span class="path">{{ currentFile || '未打开文件' }}</span>
            </el-tooltip>
          </div>
          <div class="tools">
            <!-- 预览主题切换 -->
            <el-select v-model="editorTheme" size="small" style="width: 152px" placeholder="主题" @change="onEditorThemeChange">
              <el-option label="GitHub" value="github" />
              <el-option label="Dark" value="dark" />
              <el-option label="Classic" value="classic" />
              <el-option label="Solarized" value="solarized" />
              <el-option label="Sepia" value="sepia" />
              <el-option label="Nord" value="nord" />
              <el-option label="CtBB" value="ctbb" />
            </el-select>
            <el-tooltip :content="autoSave ? '自动保存：开' : '自动保存：关'" placement="left">
              <el-switch v-model="autoSave" size="small" />
            </el-tooltip>
            <span class="save-hint" :class="saveHintClass">{{ saveHint }}</span>
            <el-tooltip content="保存" placement="left">
              <el-button
                circle
                type="primary"
                :icon="Check"
                size="small"
                @click="saveCurrent"
                :disabled="!currentFile"
              />
            </el-tooltip>
            <span style="width:8px;display:inline-block;"></span>
            <el-tooltip content="强拉：以远端为最终结果，覆盖本地" placement="top">
              <el-button size="small" @click="doForcePull">强拉</el-button>
            </el-tooltip>
            <el-tooltip content="强推：以本地为最终结果，覆盖远端" placement="top">
              <el-button size="small" type="danger" @click="doForcePush">强推</el-button>
            </el-tooltip>
          </div>
        </div>

        <!-- 命中片段只读预览（全文检索开启时显示；需已打开文件） -->
        <div v-if="currentFile && hasPreview" class="preview-box">
          <div class="preview-head">
            <div class="title">命中片段（{{ previewSnippets.length }}）</div>
            <div class="nav">
              <el-tooltip content="上一条" placement="bottom">
                <el-button size="small" circle :icon="ArrowLeftBold" @click="prevMatch" />
              </el-tooltip>
              <el-tooltip content="下一条" placement="bottom">
                <el-button size="small" circle :icon="ArrowRightBold" @click="nextMatch" />
              </el-tooltip>
              <span class="idx">{{ activeMatchIndex + 1 }} / {{ previewSnippets.length }}</span>
            </div>
          </div>
          <el-scrollbar max-height="120px">
            <ul class="list-none p-0 m-0 text-xs leading-5">
              <li
                v-for="(s, i) in previewSnippets"
                :key="i"
                @click="onSnippetClick(i)"
                class="snippet"
                :class="{ active: i === activeMatchIndex }"
              >
                <div class="whitespace-pre-wrap break-words" v-html="s.html"></div>
              </li>
            </ul>
          </el-scrollbar>
        </div>

        <!-- Git 提交 / 同步 工具条（需已打开文件） -->
        <div v-if="currentFile" class="git-bar">
          <div class="right">
            <el-input v-model="commitMsg" placeholder="提交信息" class="min-w-[180px]" />
            <el-tooltip content="提交并同步" placement="top">
              <el-button circle type="success" :loading="syncing" :icon="Refresh" @click="doSync" />
            </el-tooltip>
          </div>
        </div>

        <!-- 编辑器/预览主体：选择文件后显示，否则显示占位提示 -->
        <template v-if="currentFile">
          <FileViewer
            :relativePath="currentFile"
            v-model:editorText="editorText"
            :markdownTheme="editorTheme"
          />
        </template>
        <template v-else>
          <div class="empty-state">
            <div class="icon">📄</div>
            <div class="title">尚未打开笔记</div>
            <div class="desc">从左侧选择一个文件，或新建一条笔记开始编辑</div>
            <div class="actions">
              <el-button type="primary" :icon="Plus" @click="newNote">新建笔记</el-button>
              <el-button :icon="Refresh" @click="loadNotesList">刷新列表</el-button>
            </div>
          </div>
        </template>
      </div>
    </div>

    <!-- 移动到对话框（仅目录选择） -->
    <el-dialog
      v-model="moveDialogVisible"
      title="移动到目录"
      width="420px"
      append-to-body
      :z-index="3000"
    >
      <div class="text-xs text-gray-500 mb-2">选择目标目录（仅显示目录节点）</div>
      <el-scrollbar max-height="260px">
        <el-tree
          :data="dirOnlyTree"
          node-key="path"
          :props="{ label: 'label', children: 'children' }"
          highlight-current
          @node-click="onMoveDirSelected"
        />
      </el-scrollbar>
      <template #footer>
        <span class="dialog-footer">
          <el-button @click="moveDialogVisible = false">取消</el-button>
          <el-button type="primary" @click="confirmMoveTo">确定</el-button>
        </span>
      </template>
    </el-dialog>

    <!-- 复制进度浮窗 -->
    <div v-if="copyInProgress" class="copy-progress">
      正在复制 {{ copyDone }} / {{ copyTotal }}
    </div>
    <!-- 更新条（固定在左下角，避免影响布局） -->
    <UpdateBar @save-and-install="onSaveAndInstallFromBar" />
    <p class="mt-3 text-gray-400 text-xs foot-tip">若未选择本地库目录，请先在“设置向导”页面进行选择。</p>
  </section>
</template>

<style scoped>
/* 顶部紧凑头部栏 */
.page-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 4px; /* 更紧凑 */
}
.page-head .left { 
  display: flex; 
  align-items: baseline; 
  gap: 8px; 
  min-width: 0; 
}
.page-head .title {
  font-weight: 600;
  color: #ef5da8; /* 与原小标题风格相近 */
  font-size: 14px; /* 降低标题字号 */
}
.page-head .vault {
  font-size: 11px; /* 更小的辅助信息字号 */
  color: #6b7280;
  max-width: 60vw;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 顶部图标样式（替代“笔记”文字） */
.app-logo {
  color: #ef5da8; /* 与标题色保持一致 */
  font-size: 16px;
  margin-right: 6px;
}

/* 收紧本卡片的上下内边距，释放更多垂直空间 */
.card-cute {
  padding-top: 8px;
  padding-bottom: 8px;
  /* 明确左右内边距，避免默认更大 padding 引发横向溢出 */
  padding-left: 8px;
  padding-right: 8px;
  /* 让本页面容器充满视口高度并作为列布局，使下方网格可占满剩余空间 */
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  position: relative; /* 为底部提示绝对定位提供参照 */
  overflow: hidden;   /* 隐藏外层横/竖滚动条 */
  box-sizing: border-box; /* 将 padding 算入宽度，防止 100% + padding 溢出 */
  width: 100%;
}
/* 布局：左侧菜单 + 右侧内容 */
.notes-layout {
  display: grid;
  grid-template-columns: 280px 6px 1fr; /* 初始值，运行时由内联样式覆盖 */
  gap: 12px;
  /* 作为 .card-cute 的弹性子项，占满剩余高度 */
  flex: 1 1 auto;
  min-height: 0; /* 关键：允许内部滚动而不是把父容器撑高 */
  /* 避免出现页面横向/纵向滚动条，由子区域各自滚动 */
  overflow: hidden;
  width: 100%;
}
.notes-layout.dragging {
  cursor: col-resize;
  user-select: none;
}

/* 左侧面板工具条 */
.search-row { margin-bottom: 8px; }
.pane-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.tip-muted {
  font-size: 12px;
  color: #9ca3af;
}

/* 文件列表 */
.file-list {
  list-style: none;
  padding: 0;
  margin: 0;
}
.file-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 8px;
  border-radius: 8px;
  cursor: pointer;
  transition: background-color 0.15s ease;
}
.file-item:hover {
  background: #f5f7ff;
}
.file-item.active {
  background: #eef2ff;
}
.file-item .left {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.file-item .doc-icon {
  color: #6366f1;
}
.file-item .name {
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.file-item .badge {
  margin-left: 4px;
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 9999px;
  background: #ede9fe;
  color: #6d28d9;
}
.file-item .actions {
  display: none;
  gap: 6px;
}
.file-item:hover .actions {
  display: flex;
}

/* 右侧编辑区域 */
.editor-area {
  display: flex;
  flex-direction: column;
  gap: 10px;
  /* 作为 grid 子项，允许在横向收缩，避免撑出滚动条 */
  min-width: 0;
  /* 关键：右侧区域本身占满竖向剩余空间，供内部编辑器 100% 高度使用 */
  flex: 1 1 auto;
  min-height: 0;
}
/* 未选择文件时的占位态 */
.empty-state {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: 1px dashed #e5e7eb;
  border-radius: 10px;
  color: #6b7280;
  background: linear-gradient(180deg, #fbfdff 0%, #f8fafc 100%);
}
.empty-state .icon { font-size: 32px; line-height: 1; }
.empty-state .title { font-size: 14px; font-weight: 600; color: #374151; }
.empty-state .desc { font-size: 12px; color: #6b7280; }
.empty-state .actions { display: flex; gap: 8px; margin-top: 6px; }
/* 让子组件根元素（带 editor-flex 类）填充剩余高度；需用 :deep 穿透 scoped */
.editor-area :deep(.editor-flex) {
  display: flex;
  flex: 1 1 auto;
  min-height: 0;
}

/* 作为 grid 子项的左侧卡片也允许收缩，避免内部溢出撑破布局 */
.file-pane {
  min-width: 0;
  display: flex;
  flex-direction: column;
}
/* 让 el-card 的 body 占满并作为列布局 */
.file-pane :deep(.el-card__body) {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
}

/* 垂直分隔条（拖拽句柄） */
.v-resizer {
  width: 6px;
  cursor: col-resize;
  background: #f3f4f6;
  border-radius: 3px;
  transition: background 0.15s ease;
}
.v-resizer:hover,
.notes-layout.dragging .v-resizer {
  background: #e5e7eb;
}
.editor-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 8px;
  background: #fff;
  border: 1px solid #eee;
  border-radius: 8px;
}
.editor-toolbar .file-indicator {
  display: flex;
  align-items: center;
  gap: 6px;
  color: #6b7280;
  font-size: 12px;
}
.editor-toolbar .file-indicator .path {
  max-width: 50vw;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.editor-toolbar .tools {
  display: flex;
  gap: 8px;
  align-items: center; /* 工具条项垂直居中对齐 */
}

/* 轻量保存提示样式 */
.save-hint {
  font-size: 12px;
  user-select: none;
  display: inline-flex; /* 与开关/按钮视觉对齐 */
  align-items: center;
  line-height: 1; /* 避免文本多余行高导致偏移 */
}
.hint-muted { color: #9ca3af; }
.hint-saving { color: #2563eb; }
.hint-saved { color: #16a34a; }
.hint-dirty { color: #dc2626; }

/* 深度选择器：确保 Element Plus 开关与圆形按钮基线一致（仅作用于本组件） */
:deep(.editor-toolbar .tools .el-switch) {
  vertical-align: middle;
}
:deep(.editor-toolbar .tools .el-button.is-circle) {
  vertical-align: middle;
}

/* 预览框 */
.preview-box {
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 6px;
  background: #f9fafb;
}
.preview-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: #4b5563;
  font-size: 12px;
  margin-bottom: 6px;
}
.preview-head .nav {
  display: flex;
  align-items: center;
  gap: 6px;
}
.preview-head .idx {
  color: #9ca3af;
}
.snippet {
  padding: 4px 6px;
  border-radius: 6px;
  cursor: pointer;
}
.snippet.active {
  background: #fef3c7;
}

/* Git 工具条 */
.git-bar {
  display: flex;
  justify-content: flex-end;
}
.git-bar .right {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* 修复：编辑器全屏时应覆盖左侧树的复选框（提高层级） */
:deep(.bytemd-fullscreen) {
  z-index: 5000 !important;
}

/* 右键上下文菜单样式 */
.context-menu {
  position: fixed;
  z-index: 2000;
  min-width: 160px;
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.12);
  padding: 6px;
}
.ctx-item {
  padding: 8px 10px;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
}
.ctx-item:hover {
  background: #f3f4f6;
}
.ctx-item.disabled {
  color: #9ca3af;
  cursor: not-allowed;
  pointer-events: none;
}
.ctx-sep {
  height: 1px;
  background: #f1f5f9;
  margin: 6px 4px;
}

/* 复制进度浮窗 */
.copy-progress {
  position: fixed;
  right: 16px;
  bottom: 12px;
  z-index: 4000;
  background: rgba(17, 24, 39, 0.9);
  color: #fff;
  padding: 8px 12px;
  border-radius: 9999px;
  font-size: 12px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.2);
}

/* 树节点行布局与省略号 */
.notes-tree {
  overflow-x: hidden;
}
.notes-tree .tree-row {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  min-width: 0; /* 避免内部项撑破，保证尾部徽标可见 */
  position: relative; /* 使右侧徽标可绝对定位覆盖在行内 */
}
.notes-tree .tree-row .name {
  flex: 1 1 auto; /* 允许压缩 */
  min-width: 0;   /* 使省略号生效 */
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding-right: 28px; /* 为悬浮徽标预留空间，避免文字与徽标重叠 */
}
.notes-tree .tree-row .badge {
  /* 悬浮在文件名最右侧上方，不被挤走 */
  position: absolute;
  right: 4px;
  top: 50%;
  transform: translateY(-50%);
  flex: 0 0 auto;
  margin-left: 6px; /* 作为回退布局时的间距，绝对定位下影响极小 */
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 9999px;
  background: #ede9fe;
  color: #6d28d9;
}
/* 放宽 el-tree 节点内容容器的溢出，避免内部右侧徽标被裁剪 */
:deep(.notes-tree .el-tree-node__content) {
  overflow: visible;
}

/* 底部提示不再参与文档流，防止增加页面高度导致外层滚动条 */
.foot-tip {
  position: absolute;
  left: 12px;
  bottom: 6px;
  margin: 0;
}
</style>
