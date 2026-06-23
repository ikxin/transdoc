#!/usr/bin/env node

import { createOpenAI } from '@ai-sdk/openai'
import { createAnthropic } from '@ai-sdk/anthropic'
import type { LanguageModel } from 'ai'
import { homedir } from 'os'
import { join } from 'path'
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'fs'
import { program } from 'commander'
import { parse } from 'ini'
import {
  type ProviderConfig,
  getAllFiles,
  getGitMergeFiles,
  getOutputText,
  resolveGitConflict,
} from './utils.ts'
import { translateByChunks } from './remark.ts'

const DEFAULT_CHUNKED = true
const DEFAULT_CONCURRENCY = 10
const USER_AGENT = 'claude-cli/2.1.126 (external, cli)'
const SYSTEM_PROMPT = `将以下 markdown 格式的内容翻译成中文，请遵守以下规则：
1. 严格保持原文的 markdown 格式和结构不变
2. 代码块中只翻译注释内容，不要修改任何代码、变量名、函数名、关键字
3. HTML 中只翻译文本内容，不要修改标签名、属性名、属性值（除非属性值是面向用户的文案）
4. 直接输出翻译结果，不要用代码块包裹，不要添加任何额外的解释内容`

const configDir = join(homedir(), '.config', 'transdoc')
const configFile = join(configDir, 'app.conf')

if (!existsSync(configDir)) {
  mkdirSync(configDir, { recursive: true })
}

type RawConfig = {
  provider: string
  [provider: string]: unknown
}

const config = parse(readFileSync(configFile, 'utf-8')) as RawConfig

function createModel(provider: ProviderConfig): LanguageModel {
  if (provider.type === 'openai') {
    const openai = createOpenAI({
      apiKey: provider.api_key,
      baseURL: provider.base_url,
      headers: {
        'User-Agent': USER_AGENT,
      },
    })
    return openai(provider.model)
  }

  const anthropic = createAnthropic({
    apiKey: provider.api_key,
    baseURL: provider.base_url,
    headers: {
      'User-Agent': USER_AGENT,
    },
  })
  return anthropic(provider.model)
}

function resolveModel(): {
  provider: string
  model: LanguageModel
} {
  const selectedProvider =
    process.env.TRANSDOC_PROVIDER || config.provider
  const providerConfig = config[selectedProvider] as ProviderConfig

  return {
    provider: selectedProvider,
    model: createModel(providerConfig),
  }
}

function createConcurrencyLimiter(concurrency: number) {
  const limit = Math.max(1, concurrency)
  let activeCount = 0
  const queue: Array<() => void> = []

  const runNext = () => {
    if (activeCount >= limit || queue.length === 0) {
      return
    }

    activeCount++
    const next = queue.shift()
    next?.()
  }

  return async function withConcurrencyLimit<T>(
    task: () => Promise<T>,
  ): Promise<T> {
    await new Promise<void>((resolve) => {
      queue.push(resolve)
      runNext()
    })

    try {
      return await task()
    } finally {
      activeCount--
      runNext()
    }
  }
}

function createTranslateFn(
  model: LanguageModel,
  file: string,
  withConcurrencyLimit: <T>(task: () => Promise<T>) => Promise<T>,
) {
  let chunkIndex = 0
  return async (prompt: string) =>
    withConcurrencyLimit(async () => {
      const currentChunkIndex = ++chunkIndex
      let attempts = 0

      while (attempts < 5) {
        attempts++
        console.log(`${file} 分片 ${currentChunkIndex} 第 ${attempts} 次翻译`)
        try {
          const result = await getOutputText(model, SYSTEM_PROMPT, prompt)
          if (result) return result
        } catch (error) {
          const message =
            error instanceof Error
              ? error.stack || error.message
              : String(error)
          console.error(`上游报错，准备重试：${message}`)
        }
      }

      throw new Error(`分片 ${currentChunkIndex} 翻译失败，已达到最大重试次数`)
    })
}

async function translateFiles(
  files: string[],
  model: LanguageModel,
  concurrency: number,
) {
  const requestConcurrency = Math.max(1, concurrency)
  const taskConcurrency = Math.min(requestConcurrency, files.length)

  if (taskConcurrency === 0) {
    return
  }

  const withConcurrencyLimit = createConcurrencyLimiter(requestConcurrency)
  let nextIndex = 0

  const worker = async () => {
    while (true) {
      const currentIndex = nextIndex
      nextIndex++

      if (currentIndex >= files.length) {
        return
      }

      const file = files[currentIndex]
      const label = `任务耗时 ${file}`
      console.time(label)

      const content = readFileSync(file, 'utf-8')

      try {
        const translateFn = createTranslateFn(model, file, withConcurrencyLimit)
        const result = DEFAULT_CHUNKED
          ? await translateByChunks(content, translateFn, { filePath: file })
          : await translateFn(content)

        writeFileSync(file, result, 'utf-8')
        console.timeEnd(label)
      } catch (error) {
        console.timeEnd(label)
        console.error(`文件 ${file} 翻译失败: ${error}`)
      }
    }
  }

  await Promise.all(Array.from({ length: taskConcurrency }, () => worker()))
}

program
  .name('transdoc')
  .version('1.0.0')
  .description('基于 LLM 的命令行翻译工具')

program
  .argument('[filePath]', '需要翻译的文件路径')
  .action(async (filePath) => {
    if (!filePath) {
      console.error('请提供需要翻译的文件路径')
      console.log('使用方法: transdoc <文件路径>')
      process.exit(1)
    }

    const { provider, model } = resolveModel()
    const concurrency = DEFAULT_CONCURRENCY
    console.log(`提供商：${provider}、模型：${model.modelId}`)

    await translateFiles(getAllFiles(filePath), model, concurrency)
  })

program.command('init').action(() => {
  const configTemplate =
    'provider = openai\n' +
    '\n' +
    '[openai]\n' +
    'base_url = \n' +
    'model = \n' +
    'api_key =\n' +
    'type = \n'

  writeFileSync(join(configDir, 'app.conf'), configTemplate, 'utf-8')
  console.log('配置已保存到', configDir)
})

program.command('merge').action(async () => {
  const { provider, model } = resolveModel()
  const concurrency = DEFAULT_CONCURRENCY
  console.log(`提供商：${provider}、模型：${model.modelId}`)

  const files = await getGitMergeFiles()

  if (files.length === 0) {
    console.log('没有需要处理的文件')
    return
  }

  console.log(`正在使用 git 解决 ${files.length} 个文件的冲突...`)
  await resolveGitConflict(files)
  console.log('冲突已解决，开始翻译...')

  await translateFiles(files, model, concurrency)
})

program.parse(process.argv)
