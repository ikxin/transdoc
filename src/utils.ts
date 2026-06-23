import { globSync } from 'glob'
import { join } from 'path'
import { simpleGit } from 'simple-git'
import { statSync, readFileSync, writeFileSync } from 'fs'
import type OpenAI from 'openai'

const IGNORED_FILES = [
  'AGENTS.md',
  'CHANGELOG.md',
  'CLAUDE.md',
  'CODE_OF_CONDUCT.md',
  'CONTRIBUTING.md',
  'DEVELOPER.md',
  'LICENSE.md',
  'README.md',
  'SECURITY.md',
  'SKILL.md',
  'VISION.md',
]

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

export async function getOutputText(
  client: OpenAI,
  model: string,
  system: string,
  prompt: string,
) {
  const response = await client.responses.create({
    model,
    instructions: system,
    input: prompt,
  })

  const content = response.output_text

  if (!content) {
    throw new Error('API 返回了空的 output_text')
  }

  let result = content.trim()

  if (result.startsWith('```markdown')) {
    const i = result.indexOf('\n')
    if (i !== -1) {
      result = result.slice(i + 1)
      if (result.endsWith('```')) {
        result = result.slice(0, -3)
      }
    }
  }

  return result.endsWith('\n') ? result : result + '\n'
}
