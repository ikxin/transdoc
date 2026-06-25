import chalk from 'chalk'

export interface ProgressCallbacks {
  onFileStart: (file: string, totalChunks: number) => void
  onChunkComplete: (file: string) => void
  onFileComplete: (file: string) => void
  onFileError: (file: string, error: string) => void
}

interface FileProgress {
  file: string
  totalChunks: number
  completedChunks: number
  status: 'active' | 'done' | 'error'
  startTime: number
  endTime?: number
  error?: string
}

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const MAX_ACTIVE_DISPLAY = 5
const BAR_WIDTH = 30

function truncatePath(filePath: string): string {
  const maxLen = Math.min(process.stderr.columns ?? 120, 120) - 50
  if (filePath.length <= maxLen) return filePath
  return '…' + filePath.slice(filePath.length - maxLen + 1)
}

function logLine(f: FileProgress): void {
  const elapsed = ((f.endTime! - f.startTime) / 1000).toFixed(1)
  if (f.status === 'done') {
    process.stderr.write(
      `  ${chalk.green('✓')} ${chalk.dim(f.file)}  ${chalk.dim(`${f.totalChunks} chunks · ${elapsed}s`)}\n`,
    )
  } else {
    process.stderr.write(
      `  ${chalk.red('✗')} ${f.file}  ${chalk.red(f.error ?? '翻译失败')}\n`,
    )
  }
}

export function createReporter(
  model: string,
  concurrency: number,
  totalFiles: number,
) {
  const isTTY = process.stderr.isTTY ?? false
  const files = new Map<string, FileProgress>()
  const completedFiles: FileProgress[] = []
  const startTime = Date.now()
  let renderInterval: ReturnType<typeof setInterval> | null = null
  let lastLineCount = 0
  let frame = 0

  function clearLines() {
    if (lastLineCount > 0) {
      process.stderr.write(`\x1B[${lastLineCount}A\x1B[0J`)
      lastLineCount = 0
    }
  }

  function render() {
    frame++
    clearLines()

    const lines: string[] = []
    const done = completedFiles.length
    const percent = totalFiles > 0 ? done / totalFiles : 0
    const filled = Math.round(percent * BAR_WIDTH)
    const bar =
      chalk.cyan('█'.repeat(filled)) + chalk.dim('░'.repeat(BAR_WIDTH - filled))

    lines.push(
      ` 翻译中 [${bar}] ${chalk.bold.cyan(Math.round(percent * 100) + '%')} · ${chalk.white(`${done}/${totalFiles}`)} 文件`,
    )
    lines.push('')

    const active = [...files.values()]
    const displayed = active.slice(0, MAX_ACTIVE_DISPLAY)
    for (const f of displayed) {
      const spinner = SPINNER_FRAMES[frame % SPINNER_FRAMES.length]
      const chunkFilled =
        f.totalChunks > 0
          ? Math.round((f.completedChunks / f.totalChunks) * 10)
          : 0
      const chunkBar =
        chalk.yellow('█'.repeat(chunkFilled)) +
        chalk.dim('░'.repeat(10 - chunkFilled))
      const name = truncatePath(f.file)
      lines.push(
        `  ${chalk.cyan(spinner)} ${chalk.white(name.padEnd(45))} ${chunkBar} ${chalk.dim(`${f.completedChunks}/${f.totalChunks}`)}`,
      )
    }
    if (active.length > MAX_ACTIVE_DISPLAY) {
      lines.push(
        chalk.dim(`    ...还有 ${active.length - MAX_ACTIVE_DISPLAY} 个`),
      )
    }

    if (completedFiles.length > 0) {
      lines.push('')
      const recent = completedFiles.slice(-5)
      for (const f of recent) {
        const elapsed = ((f.endTime! - f.startTime) / 1000).toFixed(1)
        if (f.status === 'done') {
          lines.push(
            `  ${chalk.green('✓')} ${chalk.dim(truncatePath(f.file))}  ${chalk.dim(`${f.totalChunks} chunks · ${elapsed}s`)}`,
          )
        } else {
          lines.push(
            `  ${chalk.red('✗')} ${truncatePath(f.file)}  ${chalk.red(f.error ?? '翻译失败')}`,
          )
        }
      }
      if (completedFiles.length > 5) {
        lines.push(
          chalk.dim(`    ...已完成 ${completedFiles.length - 5} 个未显示`),
        )
      }
    }

    const output = lines.join('\n') + '\n'
    process.stderr.write(output)
    lastLineCount = lines.length
  }

  function renderSummary() {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
    const errors = completedFiles.filter((f) => f.status === 'error')

    process.stderr.write('\n')
    for (const f of completedFiles) {
      logLine(f)
    }
    process.stderr.write('\n')

    let summary = ` 完成 ${chalk.bold(String(completedFiles.length))} 个文件 · 耗时 ${chalk.bold.green(elapsed + 's')}`
    if (errors.length > 0) {
      summary += ` · ${chalk.bold.red(errors.length + ' 个失败')}`
    }
    process.stderr.write(summary + '\n')
  }

  const callbacks: ProgressCallbacks = {
    onFileStart(file, totalChunks) {
      files.set(file, {
        file,
        totalChunks,
        completedChunks: 0,
        status: 'active',
        startTime: Date.now(),
      })
    },
    onChunkComplete(file) {
      const f = files.get(file)
      if (f) f.completedChunks++
    },
    onFileComplete(file) {
      const f = files.get(file)
      if (f) {
        f.status = 'done'
        f.endTime = Date.now()
        files.delete(file)
        completedFiles.push(f)
        if (!isTTY) logLine(f)
      }
    },
    onFileError(file, error) {
      const f = files.get(file)
      if (f) {
        f.status = 'error'
        f.error = error
        f.endTime = Date.now()
        files.delete(file)
        completedFiles.push(f)
        if (!isTTY) logLine(f)
      }
    },
  }

  return {
    start() {
      if (isTTY) {
        process.stderr.write(
          chalk.dim(`transdoc · ${model} · 并发 ${concurrency}`) + '\n\n',
        )
        renderInterval = setInterval(render, 80)
      }
    },
    stop() {
      if (renderInterval) {
        clearInterval(renderInterval)
        renderInterval = null
      }
      if (isTTY) {
        clearLines()
        renderSummary()
      }
    },
    callbacks,
  }
}
