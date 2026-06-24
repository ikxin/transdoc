import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

export type RawConfig = {
  base_url?: string
  model: string
  api_key: string
}

export const configDir = join(homedir(), '.config', 'transdoc')
export const configFile = join(configDir, 'config.json')

export function ensureConfigDir() {
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true })
  }
}

export function loadConfig(): RawConfig {
  ensureConfigDir()

  if (!existsSync(configFile)) {
    console.error('配置文件不存在，请先运行 transdoc init 初始化配置')
    process.exit(1)
  }

  try {
    return JSON.parse(readFileSync(configFile, 'utf-8')) as RawConfig
  } catch {
    console.error('配置文件格式错误，请检查或重新运行 transdoc init')
    process.exit(1)
  }
}

export function writeDefaultConfig() {
  ensureConfigDir()

  const configTemplate: RawConfig = {
    base_url: 'https://open.markhub.top',
    model: 'gpt-5.4-mini',
    api_key: 'sk-********************************',
  }

  writeFileSync(configFile, JSON.stringify(configTemplate, null, 2), 'utf-8')

  return configDir
}
