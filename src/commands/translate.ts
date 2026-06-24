import type { Command } from 'commander'
import { DEFAULT_QUEUE } from '../config/constants.ts'
import { resolveClient } from '../service/llm.ts'
import { translateFiles } from '../service/translator.ts'
import { getAllFiles } from '../utils/files.ts'

export function registerTranslateCommand(program: Command) {
  program.argument('[filePath]', '需要翻译的文件路径').action(async (filePath) => {
    if (!filePath) {
      console.error('请提供需要翻译的文件路径')
      console.log('使用方法: transdoc <文件路径>')
      process.exit(1)
    }

    const { client, model } = resolveClient()
    const queue = DEFAULT_QUEUE
    console.log(`模型：${model}`)

    await translateFiles(getAllFiles(filePath), client, model, queue)
  })
}
