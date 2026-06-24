#!/usr/bin/env node

import { Command } from 'commander'
import { registerInitCommand } from '../commands/init.ts'
import { registerMergeCommand } from '../commands/merge.ts'
import { registerTranslateCommand } from '../commands/translate.ts'

const program = new Command()

program
  .name('transdoc')
  .version('1.0.0')
  .description('基于 LLM 的命令行翻译工具')

registerTranslateCommand(program)
registerInitCommand(program)
registerMergeCommand(program)

program.parse(process.argv)
