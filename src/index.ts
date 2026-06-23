#!/usr/bin/env node

import OpenAI from 'openai'
import { homedir } from 'os'
import { join } from 'path'
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'fs'
import { program } from 'commander'
import { parse } from 'ini'
import {
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
  base_url?: string
  model: string
  api_key: string
}

const config = parse(readFileSync(configFile, 'utf-8')) as RawConfig

function createClient(config: RawConfig): OpenAI {
  return new OpenAI({
    apiKey: config.api_key,
    baseURL: config.base_url,
    defaultHeaders: {
      'User-Agent': USER_AGENT,
    },
  })
}

function resolveClient(): {
  client: OpenAI
  model: string
} {
  const client = createClient(config)

  return {
    client,
    model: config.model,
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
  client: OpenAI,
  model: string,
  file: string,
  withConcurrencyLimit: <T>(task: () => Promise<T>) => Promise<T>,
) {
  let chunkIndex = 0
  return async (prompt: string) =>
    withConcurrencyLimit(async () => {
      const currentChunkIndex = ++chunkIndex
      let attempts = 0

      while (attempts < 3) {
        attempts++
        console.log(`${file} 分片 ${currentChunkIndex} 第 ${attempts} 次翻译`)
        try {
          const result = await getOutputText(
            client,
            model,
            SYSTEM_PROMPT,
            prompt,
          )
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
  client: OpenAI,
  model: string,
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
        const translateFn = createTranslateFn(
          client,
          model,
          file,
          withConcurrencyLimit,
        )
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

    const { client, model } = resolveClient()
    const concurrency = DEFAULT_CONCURRENCY
    console.log(`模型：${model}`)

    await translateFiles(getAllFiles(filePath), client, model, concurrency)
  })

program.command('init').action(() => {
  const configTemplate = 'base_url = \n' + 'model = \n' + 'api_key = \n'

  writeFileSync(join(configDir, 'app.conf'), configTemplate, 'utf-8')
  console.log('配置已保存到', configDir)
})

program.command('merge').action(async () => {
  const { client, model } = resolveClient()
  const concurrency = DEFAULT_CONCURRENCY
  console.log(`模型：${model}`)

  const files = await getGitMergeFiles()

  if (files.length === 0) {
    console.log('没有需要处理的文件')
    return
  }

  console.log(`正在使用 git 解决 ${files.length} 个文件的冲突...`)
  await resolveGitConflict(files)
  console.log('冲突已解决，开始翻译...')

  await translateFiles(files, client, model, concurrency)
})

program.parse(process.argv)
