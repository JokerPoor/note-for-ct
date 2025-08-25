// 文件类型判定与辅助方法（JavaScript 版本）
// 仅根据扩展名进行粗粒度分类，后续可结合 fs:stat 做更精细判断（大小/是否二进制等）

const imageExts = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'])
const markdownExts = new Set(['md', 'markdown'])
const textExts = new Set([
  'txt', 'log', 'conf', 'cfg', 'json', 'jsonl', 'js', 'ts', 'tsx', 'jsx',
  'css', 'scss', 'sass', 'less', 'yml', 'yaml', 'csv', 'tsv', 'ini', 'toml', 'xml'
])
const htmlExts = new Set(['html', 'htm'])
const audioExts = new Set(['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a', 'opus', 'amr'])
const videoExts = new Set(['mp4', 'webm', 'mkv', 'mov', 'avi'])
const officeExts = new Set(['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'])

export function getExt(p) {
  const s = String(p || '')
  const i = s.lastIndexOf('.')
  return i >= 0 ? s.slice(i + 1).toLowerCase() : ''
}

export function getFileKind(p) {
  const ext = getExt(p)
  if (markdownExts.has(ext)) return 'markdown'
  if (imageExts.has(ext)) return 'image'
  if (ext === 'pdf') return 'pdf'
  if (htmlExts.has(ext)) return 'html'
  if (audioExts.has(ext)) return 'audio'
  if (videoExts.has(ext)) return 'video'
  if (officeExts.has(ext)) return 'office'
  if (textExts.has(ext)) return 'text'
  return 'unsupported'
}

export function isTextual(kind) {
  return kind === 'markdown' || kind === 'text' || kind === 'html'
}
