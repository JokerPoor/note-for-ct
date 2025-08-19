<script setup>
// 页面：笔记主界面
// - 左侧：文件列表（带搜索/刷新/新建图标按钮）
// - 右侧：编辑区域（当前文件信息、保存图标按钮、命中预览图标导航）
// - 保持中文注释与日志
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import MarkdownEditor from '../components/MarkdownEditor.vue'
import { ElMessageBox, ElMessage } from 'element-plus'
import { useRouter, onBeforeRouteLeave } from 'vue-router'
import { createLogger } from '../utils/logger'
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
  Check
} from '@element-plus/icons-vue'

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

// ================
// 未保存变更离开拦截（当自动保存关闭时）
// ================
// 判断是否存在“未保存变更”
const hasUnsavedChanges = () => {
  // 自动保存关闭 且 有当前文件 且 文本与最近一次保存不一致
  return !autoSave.value && !!currentFile.value && editorText.value !== lastSavedText.value
}

// 二次确认：离开前提示是否保存
const confirmBeforeLeave = async (context = '离开当前页面') => {
  if (!hasUnsavedChanges()) return true
  await log.warn(`检测到未保存更改，准备${context}，弹出二次确认`)
  try {
    // 使用 MessageBox.confirm：确认=保存，取消=不保存，关闭=取消离开
    await ElMessageBox.confirm(
      '检测到当前文件有未保存的更改，是否保存后继续？',
      '未保存更改',
      {
        confirmButtonText: '保存并继续',
        cancelButtonText: '不保存',
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
      await log.info('二次确认：选择不保存并继续')
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
      window.removeEventListener('click', hideContextMenu)
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
  contextMenuX.value = event.pageX || 0
  contextMenuY.value = event.pageY || 0
  contextMenuShow.value = true
  log.info('右键菜单：目标=', data?.path)
}

// 隐藏右键菜单
const hideContextMenu = () => {
  contextMenuShow.value = false
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

// 获取当前操作的目标目录路径（优先选中目录，其次为选中文件的上级；默认 notes）
const getActiveDir = () => {
  const node = selectedNode.value
  if (node?.isDir) return node.path
  if (node?.path) return node.path.split('/').slice(0, -1).join('/') || 'notes'
  return 'notes'
}

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

// 保存当前编辑器内容到文件
const saveCurrent = async (opts = {}) => {
  // opts.silent: 是否静默（不弹出全局提示，用于自动保存）
  if (!currentFile.value) {
    ElMessage.info('没有打开的文件')
    await log.warn('保存跳过：未打开文件')
    return
  }
  // 保险：确保主进程已打开当前 Vault
  if (vaultDir.value) {
    const opened = await window.api.openVault(vaultDir.value)
    if (!opened?.ok) {
      ElMessage.error(opened?.reason || '无法打开本地库目录，请返回设置页重新选择')
      await log.error('打开 Vault 失败（保存时）：', opened?.reason || '')
      return
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
  } else {
    ElMessage.error(`保存失败：${res?.reason || ''}`)
    await log.error('保存失败：', currentFile.value, res?.reason || '')
  }
}

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

// Git 同步（pull --rebase 然后 push）
// Git 同步：pull --rebase 后 push；必要时创建远程仓库
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
    // 账户名与 Owner 一致，用于从主进程取 PAT
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
  // 执行删除
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
}

// 重命名：支持文件与目录（目录名不需要 .md）
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
      // 文件重命名：需以 .md 结尾
      const { value } = await ElMessageBox.prompt('重命名为（仅文件名，需以 .md 结尾）', '重命名', {
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        inputValue: base,
        inputPattern: /.+\.md$/,
        inputErrorMessage: '文件名需以 .md 结尾'
      })
      newName = value
    }
  } catch {
    // 用户取消
    return
  }
  const to = `notes/${newName}`
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
  } catch {}
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

// 全局点击隐藏右键菜单
if (typeof window !== 'undefined') {
  window.addEventListener('click', hideContextMenu)
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
</script>

<template>
  <section class="card-cute">
    <h2 class="section-title">笔记（notes/）</h2>
    <div class="flex items-center justify-between text-xs text-gray-500 mb-2">
      <div>当前库：{{ vaultDir || '未选择（请前往设置页）' }}</div>
      <div>
        <el-button plain @click="router.push('/setup')">去设置</el-button>
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
        <el-scrollbar max-height="300px">
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
            <template #default="{ data }">
              <!-- 点击文件名行时阻止事件冒泡，避免误触发复选框勾选；手动触发节点点击逻辑 -->
              <div
                class="tree-row"
                :class="{ active: currentFile === data.path }"
                @click.stop="onNodeClick(data)"
              >
                <el-icon class="mr-1" v-if="data.isDir"><Folder /></el-icon>
                <el-icon class="mr-1" v-else><Document /></el-icon>
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
            class="ctx-item"
            @click="
              () => {
                contextNode && renameItem(contextNode.path)
                contextMenuShow = false
              }
            "
          >
            重命名
          </div>
          <div
            class="ctx-item text-red-600"
            @click="
              () => {
                contextNode && deleteItem(contextNode.path)
                contextMenuShow = false
              }
            "
          >
            删除
          </div>
          <div
            class="ctx-item"
            @click="
              () => {
                contextNode && openMoveDialog(contextNode.path)
                contextMenuShow = false
              }
            "
          >
            移动到…
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
          </div>
        </div>

        <!-- 命中片段只读预览（全文检索开启时显示） -->
        <div v-if="hasPreview" class="preview-box">
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

        <!-- Git 提交 / 同步 工具条 -->
        <div class="git-bar">
          <div class="right">
            <el-input v-model="commitMsg" placeholder="提交信息" class="min-w-[180px]" />
            <el-tooltip content="提交" placement="top">
              <el-button circle :icon="Check" @click="doCommit" />
            </el-tooltip>
            <el-tooltip content="同步" placement="top">
              <el-button circle type="success" :loading="syncing" :icon="Refresh" @click="doSync" />
            </el-tooltip>
          </div>
        </div>

        <!-- Markdown 编辑器（Vditor 封装组件）
             传入当前文件路径以支持“就近保存到同级 assets/” -->
        <MarkdownEditor ref="mdRef" v-model="editorText" :currentFilePath="currentFile" />
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

    <p class="mt-3 text-gray-400 text-xs">若未选择本地库目录，请先在“设置向导”页面进行选择。</p>
  </section>
</template>

<style scoped>
/* 布局：左侧菜单 + 右侧内容 */
.notes-layout {
  display: grid;
  grid-template-columns: 280px 6px 1fr; /* 初始值，运行时由内联样式覆盖 */
  gap: 12px;
  min-height: 300px;
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
.ctx-sep {
  height: 1px;
  background: #f1f5f9;
  margin: 6px 4px;
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
</style>
