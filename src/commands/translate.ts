import type { Command } from 'commander'
import { DEFAULT_QUEUE } from '../config/constants.ts'
import { resolveClient } from '../service/llm.ts'
import { translateFiles } from '../service/translator.ts'
import { getAllFiles } from '../utils/files.ts'
import { createReporter } from '../utils/render.ts'

export function registerTranslateCommand(program: Command) {
  program.argument('[filePath]', '需要翻译的文件路径').action(async (filePath) => {
    if (!filePath) {
      console.error('请提供需要翻译的文件路径')
      console.log('使用方法: transdoc <文件路径>')
      process.exit(1)
    }

    const { client, model } = resolveClient()
    const queue = DEFAULT_QUEUE
    const files = getAllFiles(filePath)

    const reporter = createReporter(model, queue, files.length)
    reporter.start()

    await translateFiles(files, client, model, queue, reporter.callbacks)

    reporter.stop()
  })
}
