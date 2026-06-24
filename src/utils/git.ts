import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { simpleGit } from 'simple-git'
import { IGNORED_FILES } from '../config/constants.ts'

export async function getGitMergeFiles() {
  const git = simpleGit()
  const status = await git.status(['--porcelain'])

  const files = status.files
    .filter((file) => {
      const rules =
        (file.index === 'U' && file.working_dir === 'U') ||
        (file.index === 'A' && file.working_dir === ' ') ||
        (file.index === 'M' && file.working_dir === ' ')

      const isIgnored = IGNORED_FILES.some((f) => file.path.endsWith(f))

      return /\.(md|mdx)$/i.test(file.path) && rules && !isIgnored
    })
    .map((file) => join(process.cwd(), file.path))

  return files.sort((a, b) => a.localeCompare(b))
}

export async function resolveGitConflict(files: string[]) {
  const git = simpleGit()
  for (const file of files) {
    const content = readFileSync(file, 'utf-8')
    const resolved = content.replace(
      /^<{7}[^\n]*\n([\s\S]*?)^={7}\n([\s\S]*?)^>{7}[^\n]*\n/gm,
      (_match, _ours, theirs) => theirs,
    )
    writeFileSync(file, resolved, 'utf-8')
    try {
      await git.add(file)
    } catch {
      // 跳过被 .gitignore 忽略的文件
    }
  }
}
