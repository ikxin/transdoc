import { statSync } from 'fs'
import { globSync } from 'glob'
import { IGNORED_FILES } from '../config/constants.ts'

export function getAllFiles(filePath: string) {
  const isFile = statSync(filePath).isFile()
  const filePattern = isFile ? filePath : '**/*.{md,mdx}'

  const files = globSync(filePattern, {
    absolute: true,
    cwd: isFile ? process.cwd() : filePath,
    nodir: true,
    ignore: [
      '**/node_modules/**',
      '**/.git/**',
      ...IGNORED_FILES.map((f) => `**/${f}`),
    ],
  })

  return files.sort((a, b) => a.localeCompare(b))
}
