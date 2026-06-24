import { readFileSync, writeFileSync } from 'fs'
import type OpenAI from 'openai'
import pLimit from 'p-limit'
import { DEFAULT_CHUNKED, SYSTEM_PROMPT } from '../config/constants.ts'
import { translateByChunks } from '../utils/markdown.ts'
import { getOutputText } from './llm.ts'

function createTranslateFn(
  client: OpenAI,
  model: string,
  file: string,
  limit: ReturnType<typeof pLimit>,
) {
  let chunkIndex = 0
  return async (prompt: string) =>
    limit(async () => {
      const currentChunkIndex = ++chunkIndex
      let attempts = 0

      while (attempts < 3) {
        attempts++
        console.log(`${file} 分片 ${currentChunkIndex} 第 ${attempts} 次翻译`)
        try {
          const result = await getOutputText(client, model, SYSTEM_PROMPT, prompt)
          if (result) return result
        } catch (error) {
          const message =
            error instanceof Error ? error.stack || error.message : String(error)
          console.error(`上游报错，准备重试：${message}`)
        }
      }

      throw new Error(`分片 ${currentChunkIndex} 翻译失败，已达到最大重试次数`)
    })
}

export async function translateFiles(
  files: string[],
  client: OpenAI,
  model: string,
  queue: number,
) {
  const requestLimit = Math.max(1, queue)
  const workerCount = Math.min(requestLimit, files.length)

  if (workerCount === 0) {
    return
  }

  const limit = pLimit(requestLimit)
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
        const translateFn = createTranslateFn(client, model, file, limit)
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

  await Promise.all(Array.from({ length: workerCount }, () => worker()))
}
