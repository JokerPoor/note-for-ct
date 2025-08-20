<script setup>
import { ref, onMounted, watch, reactive, computed } from 'vue'
import { QuestionFilled } from '@element-plus/icons-vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { createLogger } from '../utils/logger'

// 日志器（作用域：设置）
const log = createLogger('设置')

// 本地库（Vault）目录
const vaultDir = ref('')

// Gitee 仓库信息与凭据（统一表单模型，便于校验）
const repoForm = reactive({
  giteeOwner: '', // 你的 Gitee 用户名
  repoName: 'notes', // 仓库名，默认 notes
  branch: 'main',
  gitUserName: '', // Git 提交用户名
  gitUserEmail: '' // Git 提交邮箱
})
const repoElForm = ref()
const repoRules = {
  giteeOwner: [{ required: true, message: '请输入 Gitee 用户名', trigger: 'blur' }],
  repoName: [{ required: true, message: '请输入仓库名', trigger: 'blur' }],
  branch: [{ required: true, message: '请输入分支', trigger: 'blur' }],
  gitUserEmail: [{ type: 'email', message: '邮箱格式不正确', trigger: ['blur', 'change'] }]
}
const pat = ref('') // 个人访问令牌（PAT）
const patSaved = ref(false) // 当前 Owner 是否已有保存的 PAT（不显示明文）
const patSource = ref('') // 'store' | 'memory' | ''
const lastSavedAt = ref('') // 最近保存时间（ISO 字符串）
const rememberPat = ref(true) // 是否持久化保存（记住密码）

// 展示用状态文案与样式（source: 'store' 视为持久化；'memory' 为临时）
const patStatusText = computed(() => {
  if (!patSaved.value) return '未保存'
  return patSource.value === 'store' ? '已保存（持久化）' : '已保存（临时）'
})
const patStatusClass = computed(() => {
  if (!patSaved.value) return 'text-gray-400'
  return patSource.value === 'store' ? 'text-green-600' : 'text-yellow-600'
})

// Element Plus 全局设置（默认：小+中文），在此配置并全局生效
const uiSize = ref('small') // 'large' | 'default' | 'small'
const uiLang = ref('zh-CN') // 'zh-CN' | 'en'
const uiLoaded = ref(false)
let saveTimer = null
let lastUiSize = 'small'
let lastUiLang = 'zh-CN'

// 图片粘贴设置（持久化配置）
const imgCfg = reactive({
  assetsDir: 'assets/images',   // 基于 Vault 的相对目录
  subdirByDate: true,           // 是否按 年/月 分目录
  naming: 'timestamp',          // 命名规则：timestamp | original
  nearNoteAssets: false         // 就近保存到当前笔记同级 assets/
})
let imgLoaded = false

// 保存界面偏好（带防抖）
const saveUiPrefs = async () => {
  // 未加载完成时不触发
  if (!uiLoaded.value) return
  // 未变化则跳过
  if (uiSize.value === lastUiSize && uiLang.value === lastUiLang) return
  // 记录并持久化（防抖）
  lastUiSize = uiSize.value
  lastUiLang = uiLang.value
  clearTimeout(saveTimer)
  saveTimer = setTimeout(async () => {
    try {
      await window.api.settingsSet('uiSize', uiSize.value)
      await window.api.settingsSet('uiLang', uiLang.value)
      await log.info('已保存界面偏好：', { size: uiSize.value, lang: uiLang.value })
    } catch {}
    // 通知应用刷新全局配置
    window.dispatchEvent(new Event('app:configChanged'))
  }, 120)
}

onMounted(async () => {
  await log.debug('挂载，开始读取界面偏好与表单回显')
  try {
    const r1 = await window.api.settingsGet('uiSize')
    const r2 = await window.api.settingsGet('uiLang')
    const size = r1?.ok && r1.value ? r1.value : 'small'
    const lang = r2?.ok && r2.value ? r2.value : 'zh-CN'
    uiSize.value = ['large', 'default', 'small'].includes(size) ? size : 'small'
    uiLang.value = ['zh-CN', 'en'].includes(lang) ? lang : 'zh-CN'
    // 初始化上次值，避免首轮触发
    lastUiSize = uiSize.value
    lastUiLang = uiLang.value
    uiLoaded.value = true
    await log.debug('界面偏好读取完成')
  } catch {}
  // 读取图片粘贴设置
  try {
    const d = await window.api.settingsGet('pasteImage.assetsDir')
    const s = await window.api.settingsGet('pasteImage.subdirByDate')
    const n = await window.api.settingsGet('pasteImage.naming')
    const nn = await window.api.settingsGet('pasteImage.nearNoteAssets')
    if (d?.ok && d.value) imgCfg.assetsDir = String(d.value)
    if (s?.ok && typeof s.value === 'boolean') imgCfg.subdirByDate = s.value
    if (n?.ok && (n.value === 'timestamp' || n.value === 'original')) imgCfg.naming = n.value
    if (nn?.ok && typeof nn.value === 'boolean') imgCfg.nearNoteAssets = nn.value
    imgLoaded = true
    await log.debug('图片粘贴设置读取完成：', JSON.stringify(imgCfg))
  } catch {}
})

watch([uiSize, uiLang], () => saveUiPrefs())

// 简化设置页面：不再提供 PAT 指南切换，保留核心配置项与操作

// 选择或创建本地库目录
// 选择/创建 Vault 目录
const onSelectVault = async () => {
  const res = await window.api.selectVault()
  if (res?.ok) {
    vaultDir.value = res.dir
    try {
      await window.api.settingsSet('vaultDir', res.dir)
      await log.info('已选择 Vault 目录：', res.dir)
    } catch {}
  } else if (!res?.canceled) {
    ElMessage.error(res?.reason || '选择目录失败')
    await log.warn('选择 Vault 目录失败：', res?.reason || '')
  }
}

// 保存凭据与相关设置
const onSaveCredential = async () => {
  // 基础校验：Vault 必选
  if (!vaultDir.value) {
    ElMessage.error('请先选择本地库目录')
    await log.warn('保存凭据失败：未选择 Vault 目录')
    return
  }
  // 表单校验
  const passed = await repoElForm.value?.validate().catch(() => false)
  if (!passed) return
  // 先保存可持久化配置
  try {
    await window.api.settingsSet('gitOwner', repoForm.giteeOwner || '')
    await window.api.settingsSet('gitRepo', repoForm.repoName || 'notes')
    await window.api.settingsSet('gitBranch', repoForm.branch || 'main')
    await window.api.settingsSet('gitUserName', repoForm.gitUserName || '')
    await window.api.settingsSet('gitUserEmail', repoForm.gitUserEmail || '')
    await log.info('已保存 Git/仓库配置：', {
      owner: repoForm.giteeOwner,
      repo: repoForm.repoName,
      branch: repoForm.branch,
      user: repoForm.gitUserName,
      email: repoForm.gitUserEmail
    })
  } catch {}

  // 若提供 PAT，则根据 rememberPat 决定是否持久化
  if (pat.value) {
    const res = await window.api.saveCredential(repoForm.giteeOwner, pat.value, !!rememberPat.value)
    if (!res?.ok) {
      ElMessage.error(`PAT 保存失败：${res?.reason || ''}`)
      await log.error('PAT 保存失败：', res?.reason || '')
    } else {
      patSaved.value = true
      // 设置来源标识
      if (res.tempOnly || res.fallback || rememberPat.value === false) {
        patSource.value = 'memory'
      } else {
        patSource.value = res.source || 'store'
      }
      // 非持久化提示
      if (res.tempOnly) {
        ElMessage.warning('已保存为临时凭据（不会持久化）。应用重启后需要重新输入 PAT')
        await log.warn('PAT 保存为临时（persist=false）')
      } else if (res.fallback) {
        // 持久化失败（例如写入 store 异常），回退为内存
        ElMessage.warning('持久化保存失败，已改为临时保存（重启后失效）')
        await log.warn('PAT 持久化失败，回退为临时（内存）')
      }
      await log.info('PAT 保存完成（不记录明文）')
    }
  }

  // 记录保存时间
  const ts = new Date().toISOString()
  lastSavedAt.value = ts
  try {
    await window.api.settingsSet('settingsSavedAt', ts)
    await log.debug('保存时间写入：', ts)
  } catch {}

  ElMessage.success('设置已保存')
  await log.info('设置保存流程完成，返回欢迎页')
  router.push('/welcome')
}

const router = useRouter()

// 回显已保存的设置（除 PAT）
onMounted(async () => {
  try {
    const v = await window.api.settingsGet('vaultDir')
    if (v?.ok && v.value) vaultDir.value = v.value
    const owner = await window.api.settingsGet('gitOwner')
    const repo = await window.api.settingsGet('gitRepo')
    const br = await window.api.settingsGet('gitBranch')
    const gu = await window.api.settingsGet('gitUserName')
    const ge = await window.api.settingsGet('gitUserEmail')
    if (owner?.ok && owner.value) repoForm.giteeOwner = owner.value
    if (repo?.ok && repo.value) repoForm.repoName = repo.value
    if (br?.ok && br.value) repoForm.branch = br.value
    if (gu?.ok && gu.value) repoForm.gitUserName = gu.value
    if (ge?.ok && ge.value) repoForm.gitUserEmail = ge.value
    // 最近保存时间
    const savedAt = await window.api.settingsGet('settingsSavedAt')
    if (savedAt?.ok && savedAt.value) lastSavedAt.value = savedAt.value
    // PAT 不回显（安全）
    await window.api.logDebug('[设置页] 表单回显完成（不包含 PAT）')
  } catch {}
})

// 检查当前 Owner 是否已保存 PAT，并记录来源（持久化/临时）
const checkPatSaved = async () => {
  patSaved.value = false
  patSource.value = ''
  if (!repoForm.giteeOwner) return
  try {
    const r = await window.api.getCredential(repoForm.giteeOwner)
    patSaved.value = !!r?.ok
    patSource.value = r?.ok ? (r.source || '') : ''
    await log.debug('PAT 检查：', repoForm.giteeOwner, patSaved.value ? '已保存' : '未保存')
  } catch {}
}

watch(
  () => repoForm.giteeOwner,
  () => {
    checkPatSaved()
  }
)
onMounted(() => {
  checkPatSaved()
})

//（已移除：测试连接、创建仓库功能）

// 保存图片粘贴设置
const onSavePasteImage = async () => {
  try {
    // 基础清理：去除首尾斜杠与多余分隔
    const dir = String(imgCfg.assetsDir || 'assets/images')
      .replace(/\\+/g, '/').replace(/^\/+|\/+$/g, '') || 'assets/images'
    imgCfg.assetsDir = dir
    await window.api.settingsSet('pasteImage.assetsDir', dir)
    await window.api.settingsSet('pasteImage.subdirByDate', !!imgCfg.subdirByDate)
    await window.api.settingsSet('pasteImage.naming', imgCfg.naming === 'original' ? 'original' : 'timestamp')
    await window.api.settingsSet('pasteImage.nearNoteAssets', !!imgCfg.nearNoteAssets)
    ElMessage.success('图片粘贴设置已保存')
    await log.info('已保存图片粘贴设置：', JSON.stringify(imgCfg))
    // 通知应用刷新（可选）
    window.dispatchEvent(new Event('app:configChanged'))
  } catch (e) {
    ElMessage.error('保存失败，请稍后重试')
    await log.error('保存图片粘贴设置失败：', String(e?.message || e))
  }
}
</script>

<template>
  <section class="card-cute">
    <!-- 顶部标题 + 开始使用按钮（当 PAT 已保存时显示） -->
    <div class="flex items-center justify-between mb-2">
      <h2 class="section-title">基础配置</h2>
      <el-button v-if="patSaved" type="success" @click="router.push('/welcome')">开始使用</el-button>
    </div>

    <!-- Vault 区块 -->
    <el-card shadow="never" class="mb-4">
      <div class="flex items-center justify-between">
        <div>
          <div class="text-sm text-gray-600 mb-1">本地库目录</div>
          <div class="text-xs text-gray-500">用于存放 notes/ 目录及 Git 仓库</div>
        </div>
        <div class="flex items-center gap-2">
          <el-button type="primary" @click="onSelectVault">选择/创建本地库目录</el-button>
          <span class="text-sm text-gray-700">{{ vaultDir || '未选择' }}</span>
        </div>
      </div>
    </el-card>

    <!-- Gitee 仓库与 Git 身份 -->
    <el-card shadow="never" class="mb-4">
      <template #header>
        <div class="flex items-center justify-between w-full">
          <span class="font-medium flex items-center gap-2">
            Gitee 仓库与 Git 身份
            <el-tooltip
              placement="top"
              content="Owner/Repo/Branch 用于远端同步；Git 用户名与邮箱用于本地提交签名"
            >
              <el-icon class="text-gray-400 cursor-help"><QuestionFilled /></el-icon>
            </el-tooltip>
          </span>
          <span class="text-xs text-gray-400">用于远端同步与本地提交信息</span>
        </div>
      </template>
      <el-form
        ref="repoElForm"
        :model="repoForm"
        :rules="repoRules"
        label-width="120px"
        label-position="left"
        class="max-w-[720px]"
      >
        <el-form-item label="Gitee 用户名" prop="giteeOwner">
          <!-- 输入 Gitee 用户名；下方给出获取方式说明（中文） -->
          <el-input v-model="repoForm.giteeOwner" placeholder="your-gitee-name" />
          <div class="text-xs text-gray-400 mt-1">
            登录 <a href="https://gitee.com/" target="_blank" class="text-blue-500 hover:underline">Gitee</a> → 个人主页 → 头像下方 @ 后面的字符串即用户名（不含 @）
          </div>
        </el-form-item>
        <el-form-item label="仓库名" prop="repoName">
          <el-input v-model="repoForm.repoName" placeholder="notes（建议使用 notes）" />
        </el-form-item>
        <el-form-item label="分支" prop="branch">
          <el-input v-model="repoForm.branch" placeholder="main（默认 main）" />
        </el-form-item>
        <el-form-item label="Git 用户名">
          <el-input v-model="repoForm.gitUserName" placeholder="你的提交用户名" />
        </el-form-item>
        <el-form-item label="Git 邮箱" prop="gitUserEmail">
          <el-input v-model="repoForm.gitUserEmail" placeholder="你的提交邮箱" />
        </el-form-item>
      </el-form>
    </el-card>

    <!-- 图片粘贴设置 -->
    <el-card shadow="never" class="mt-4">
      <template #header>
        <span class="font-medium">图片粘贴设置</span>
      </template>
      <el-form label-width="140px" label-position="left" class="max-w-[720px]">
        <el-form-item label="保存目录（相对 Vault）">
          <el-input v-model="imgCfg.assetsDir" placeholder="assets/images" />
          <div class="text-xs text-gray-400 mt-1">示例：assets/images；将保存到 Vault/该目录 下</div>
        </el-form-item>
        <el-form-item label="就近保存到同级 assets/">
          <el-switch v-model="imgCfg.nearNoteAssets" />
          <div class="text-xs text-gray-400 mt-1">开启后优先生效：图片会保存到 当前笔记所在目录 的 assets/ 子目录</div>
        </el-form-item>
        <el-form-item label="按年月分目录">
          <el-switch v-model="imgCfg.subdirByDate" />
          <div class="text-xs text-gray-400 mt-1">开启后将保存到 目录/年/月，例如 2025/08</div>
        </el-form-item>
        <el-form-item label="命名规则">
          <el-select v-model="imgCfg.naming" class="w-[240px]">
            <el-option label="时间戳" value="timestamp" />
            <el-option label="保留原文件名" value="original" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="onSavePasteImage">保存图片粘贴设置</el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <!-- 凭据（PAT） -->
    <el-card shadow="never" class="mb-4">
      <template #header>
        <div class="flex items-center justify-between w-full">
          <span class="font-medium flex items-center gap-2">
            凭据（PAT）
            <el-tooltip
              placement="top"
              content="在 Gitee 个人设置-安全设置-私人令牌 生成 PAT。请妥善保管，不会在界面回显。"
            >
              <el-icon class="text-gray-400 cursor-help"><QuestionFilled /></el-icon>
            </el-tooltip>
          </span>
          <span class="text-xs" :class="patStatusClass">
            {{ patStatusText }}
          </span>
        </div>
      </template>
      <el-form label-width="120px" label-position="left" class="max-w-[720px]">
        <el-form-item label="Gitee PAT">
          <el-input v-model="pat" placeholder="个人访问令牌" type="password" />
        </el-form-item>
        <el-form-item label="记住 PAT">
          <el-switch v-model="rememberPat" />
          <div class="text-xs text-gray-400 mt-1">
            关闭后仅在本次运行内生效，重启应用需重新输入。
          </div>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="onSaveCredential">保存凭据</el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <!-- 界面设置 -->
    <el-card shadow="never">
      <template #header>
        <span class="font-medium flex items-center gap-2">
          界面设置
          <el-tooltip placement="top" content="组件大小与语言为全局设置，修改后立即生效">
            <el-icon class="text-gray-400 cursor-help"><QuestionFilled /></el-icon>
          </el-tooltip>
        </span>
      </template>
      <el-form label-width="120px" label-position="left" class="max-w-[720px]">
        <el-form-item label="组件大小">
          <el-select v-model="uiSize" class="w-[200px]">
            <el-option label="大 (large)" value="large" />
            <el-option label="默认 (default)" value="default" />
            <el-option label="小 (small)" value="small" />
          </el-select>
        </el-form-item>
        <el-form-item label="语言">
          <el-select v-model="uiLang" class="w-[200px]">
            <el-option label="中文 (zh-CN)" value="zh-CN" />
            <el-option label="English (en)" value="en" />
          </el-select>
        </el-form-item>
        <div class="text-xs text-gray-400 -mt-2">更改将自动生效</div>
      </el-form>
    </el-card>

    <!-- 保存时间展示 -->
    <div class="text-xs text-gray-400 mt-2">
      最后保存时间：
      <span v-if="lastSavedAt">{{ new Date(lastSavedAt).toLocaleString() }}</span>
      <span v-else>暂无</span>
    </div>
  </section>
</template>
