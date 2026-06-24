import type { Command } from 'commander'
import { writeDefaultConfig } from '../config/index.ts'

export function registerInitCommand(program: Command) {
  program.command('init').action(() => {
    const dir = writeDefaultConfig()
    console.log('配置已保存到', dir)
  })
}
