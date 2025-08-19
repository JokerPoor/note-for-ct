// 统一的渲染进程日志工具（中文注释）
// 使用方式：
//   import { createLogger } from '@/utils/logger'
//   const log = createLogger('关于')
//   log.info('页面已挂载')
//
// 日志会通过 preload 暴露的 window.api.* 接口转发到主进程，
// 主进程使用 electron-log 写入每日日志文件，满足长期保留的需求。

/**
 * 创建带作用域前缀的日志器
 * @param {string} scope 作用域名称（页面/组件名），如："关于"、"App"、"Router"
 */
export function createLogger(scope = '') {
  // 统一前缀：[作用域]
  const prefix = scope ? `[${scope}]` : ''

  // 当 window.api 不可用时做降级，避免在某些环境报错
  const safe = {
    info: (...args) => console.info(prefix, ...args),
    warn: (...args) => console.warn(prefix, ...args),
    error: (...args) => console.error(prefix, ...args),
    debug: (...args) => console.debug(prefix, ...args)
  }

  const api = (typeof window !== 'undefined' && window.api) ? window.api : null

  return {
    /** 重要信息 */
    info: async (...args) => {
      if (api?.logInfo) return api.logInfo(prefix, ...args)
      return safe.info(...args)
    },
    /** 警告信息 */
    warn: async (...args) => {
      if (api?.logWarn) return api.logWarn(prefix, ...args)
      return safe.warn(...args)
    },
    /** 错误信息 */
    error: async (...args) => {
      if (api?.logError) return api.logError(prefix, ...args)
      return safe.error(...args)
    },
    /** 调试信息 */
    debug: async (...args) => {
      if (api?.logDebug) return api.logDebug(prefix, ...args)
      return safe.debug(...args)
    }
  }
}

export default { createLogger }
