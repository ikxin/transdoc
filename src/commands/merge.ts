import type { Command } from 'commander'
import { DEFAULT_QUEUE } from '../config/constants.ts'
import { resolveClient } from '../service/llm.ts'
import { translateFiles } from '../service/translator.ts'
import { getGitMergeFiles, resolveGitConflict } from '../utils/git.ts'
import { createReporter } from '../utils/render.ts'

export function registerMergeCommand(program: Command) {
  program.command('merge').action(async () => {
    const { client, model } = resolveClient()
    const queue = DEFAULT_QUEUE

    const files = await getGitMergeFiles()

    if (files.length === 0) {
      console.log('没有需要处理的文件')
      return
    }

    console.log(`正在使用 git 解决 ${files.length} 个文件的冲突...`)
    await resolveGitConflict(files)
    console.log('冲突已解决，开始翻译...\n')

    const reporter = createReporter(model, queue, files.length)
    reporter.start()

    await translateFiles(files, client, model, queue, reporter.callbacks)

    reporter.stop()
  })
}
