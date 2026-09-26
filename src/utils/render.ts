import chalk from 'chalk'

export interface ChunkProgress {
  index: number
  size: number
}

export interface ProgressCallbacks {
  onFileStart: (file: string, chunks: ChunkProgress[]) => void
  onChunkStart: (file: string, chunk: ChunkProgress) => void
  onChunkComplete: (
    file: string,
    chunk: ChunkProgress,
    outputTokens: number,
  ) => void
  onFileComplete: (file: string) => void
  onFileError: (file: string, error: string) => void
}

interface FileProgress {
  file: string
  totalChunks: number
  completedChunks: number
  chunkSizes: number[]
  activeChunkSizes: number[]
  completedChunkSizes: number[]
  outputTokens: number
  status: 'active' | 'done' | 'error'
  startTime: number
  endTime?: number
  error?: string
}

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const MAX_ACTIVE_DISPLAY = 5
const MAX_RECENT_DISPLAY = 5
const BAR_WIDTH = 28
const CHUNK_BAR_WIDTH = 12

function terminalWidth(): number {
  return process.stderr.columns ?? 100
}

function truncatePath(filePath: string, maxLen?: number): string {
  maxLen ??= Math.max(24, Math.min(terminalWidth(), 120) - 58)
  if (filePath.length <= maxLen) return filePath
  return '…' + filePath.slice(filePath.length - maxLen + 1)
}

function activePathWidth(): number {
  return Math.max(24, Math.min(44, terminalWidth() - 40))
}

function compactModelName(model: string): string {
  return truncatePath(model, Math.max(18, Math.min(36, terminalWidth() - 58)))
}

function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 60) return `${seconds}s`

  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`

  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  return `${hours}h ${remainingMinutes}m`
}

function formatDecimal(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return '0'
  return value.toFixed(digits)
}

function formatCharacterCount(size: number): string {
  if (!Number.isFinite(size) || size <= 0) return '0 个字符'
  return `${Math.round(size).toLocaleString('zh-CN')} 个字符`
}

function formatTokenRate(tokens: number, elapsedMs: number): string {
  if (tokens <= 0 || elapsedMs <= 0) return '0 token/s'
  return `${formatDecimal(tokens / (elapsedMs / 1000))} token/s`
}

function chunkSizeSummary(sizes: number[]): string {
  if (sizes.length === 0) return '无可翻译块'

  const total = sizes.reduce((sum, size) => sum + size, 0)
  const average = total / sizes.length
  const max = Math.max(...sizes)

  if (sizes.length === 1) return formatCharacterCount(max)
  return `均 ${formatCharacterCount(average)} · 最大 ${formatCharacterCount(max)}`
}

function maxChunkSize(files: FileProgress[]): number {
  return Math.max(0, ...files.flatMap((file) => file.chunkSizes))
}

function progressBar(percent: number, width: number, color = chalk.cyan): string {
  const safePercent = Math.max(0, Math.min(1, percent))
  const filled = Math.round(safePercent * width)
  return color('█'.repeat(filled)) + chalk.dim('░'.repeat(width - filled))
}

function fileWorkProgress(file: FileProgress): number {
  if (file.status !== 'active') return 1
  if (file.totalChunks === 0) return 1
  return Math.max(0, Math.min(1, file.completedChunks / file.totalChunks))
}

function formatProgressValue(value: number): string {
  if (!Number.isFinite(value)) return '0'
  if (Math.abs(value - Math.round(value)) < 0.05) {
    return String(Math.round(value))
  }
  return value.toFixed(1)
}

function statusPill(label: string, color = chalk.cyan): string {
  return `${color('●')} ${chalk.bold(label)}`
}

function logErrorLine(f: FileProgress): void {
  process.stderr.write(
    `  ${chalk.red('✗')} ${f.file}  ${chalk.dim(`${f.totalChunks} 块 · ${chunkSizeSummary(f.chunkSizes)}`)}  ${chalk.red(f.error ?? '翻译失败')}\n`,
  )
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
  let discoveredChunks = 0
  let completedChunks = 0
  let completedOutputTokens = 0

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
    const failed = completedFiles.filter((f) => f.status === 'error').length
    const succeeded = done - failed
    const active = [...files.values()]
    const queued = Math.max(0, totalFiles - done - active.length)
    const elapsedMs = Date.now() - startTime
    const elapsed = formatDuration(elapsedMs)
    const activeProgress = active.reduce(
      (total, file) => total + fileWorkProgress(file),
      0,
    )
    const effectiveDone = Math.min(totalFiles, done + activeProgress)
    const percent = totalFiles > 0 ? effectiveDone / totalFiles : 0
    const bar = progressBar(percent, BAR_WIDTH)
    const tokenRate = formatTokenRate(completedOutputTokens, elapsedMs)
    const remainingWork = Math.max(0, totalFiles - effectiveDone)
    const eta =
      effectiveDone > 0 && remainingWork > 0
        ? formatDuration((elapsedMs / effectiveDone) * remainingWork)
        : remainingWork === 0
          ? '0s'
          : '计算中'
    const chunkTotal = discoveredChunks > 0 ? String(discoveredChunks) : '?'
    const knownFiles = [...active, ...completedFiles]
    const largestChunkSize = maxChunkSize(knownFiles)
    const chunkSizeLabel =
      largestChunkSize > 0
        ? `最大 ${formatCharacterCount(largestChunkSize)}`
        : '等待解析'

    lines.push(
      `${statusPill('翻译中')}  ${chalk.dim('模型')} ${chalk.white(compactModelName(model))}  ${chalk.dim('并发')} ${chalk.white(String(concurrency))}  ${chalk.dim('文件')} ${chalk.white(String(totalFiles))}`,
    )
    lines.push(
      ` ${chalk.dim('进度')} [${bar}] ${chalk.bold.cyan(Math.round(percent * 100) + '%')}  ${chalk.white(`${formatProgressValue(effectiveDone)}/${totalFiles}`)} 折算文件  ${chalk.dim(`完成 ${succeeded} · 失败 ${failed}`)}`,
    )
    lines.push(
      ` ${chalk.dim('队列')} ${chalk.white(`${active.length} 运行`)} · ${chalk.white(`${queued} 等待`)}  ${chalk.dim('耗时')} ${chalk.white(elapsed)}  ${chalk.dim('预计剩余')} ${chalk.white(eta)}`,
    )
    lines.push(
      ` ${chalk.dim('速度')} ${chalk.white(tokenRate)}  ${chalk.dim('返回')} ${chalk.white(`${completedOutputTokens.toLocaleString('zh-CN')} tokens`)}  ${chalk.dim('分块')} ${chalk.white(`${completedChunks}/${chunkTotal}`)}  ${chalk.dim(chunkSizeLabel)}`,
    )
    lines.push('')

    const displayed = active.slice(0, MAX_ACTIVE_DISPLAY)
    if (displayed.length > 0) {
      lines.push(chalk.dim(' 当前任务'))
      for (const f of displayed) {
        const spinner = SPINNER_FRAMES[frame % SPINNER_FRAMES.length]
        const chunkPercent = fileWorkProgress(f)
        const chunkBar = progressBar(
          chunkPercent,
          CHUNK_BAR_WIDTH,
          chalk.yellow,
        )
        const nameWidth = activePathWidth()
        const name = truncatePath(f.file, nameWidth)
        const elapsedForFile = formatDuration(Date.now() - f.startTime)
        const chunkLabel =
          f.totalChunks > 0
            ? `${f.completedChunks}/${f.totalChunks}`
            : '无需分块'
        const activeChunkSize =
          f.activeChunkSizes.length > 0
            ? `当前 ${formatCharacterCount(Math.max(...f.activeChunkSizes))}`
            : chunkSizeSummary(f.chunkSizes)
        lines.push(
          `  ${chalk.cyan(spinner)} ${chalk.white(name.padEnd(nameWidth))} ${chunkBar} ${chalk.bold.yellow(`${Math.round(chunkPercent * 100)}%`)} ${chalk.dim(`${chunkLabel} · ${activeChunkSize} · ${elapsedForFile}`)}`,
        )
      }
      if (active.length > MAX_ACTIVE_DISPLAY) {
        lines.push(
          chalk.dim(`    ...还有 ${active.length - MAX_ACTIVE_DISPLAY} 个`),
        )
      }
    } else if (done < totalFiles) {
      lines.push(chalk.dim(' 当前任务'))
      lines.push(chalk.dim('  正在等待任务启动...'))
    }

    if (completedFiles.length > 0) {
      lines.push('')
      lines.push(chalk.dim(' 最近完成'))
      const recent = completedFiles.slice(-MAX_RECENT_DISPLAY)
      for (const f of recent) {
        const elapsedForFile = formatDuration(f.endTime! - f.startTime)
        if (f.status === 'done') {
          lines.push(
            `  ${chalk.green('✓')} ${chalk.dim(truncatePath(f.file))}  ${chalk.dim(`${f.totalChunks} 块 · ${chunkSizeSummary(f.chunkSizes)} · ${elapsedForFile}`)}`,
          )
        } else {
          lines.push(
            `  ${chalk.red('✗')} ${truncatePath(f.file)}  ${chalk.dim(`${f.totalChunks} 块 · ${chunkSizeSummary(f.chunkSizes)}`)}  ${chalk.red(f.error ?? '翻译失败')}`,
          )
        }
      }
      if (completedFiles.length > MAX_RECENT_DISPLAY) {
        lines.push(
          chalk.dim(
            `    ...已完成 ${completedFiles.length - MAX_RECENT_DISPLAY} 个未显示`,
          ),
        )
      }
    }

    const output = lines.join('\n') + '\n'
    process.stderr.write(output)
    lastLineCount = lines.length
  }

  function renderSummary() {
    const elapsedMs = Date.now() - startTime
    const elapsed = formatDuration(elapsedMs)
    const errors = completedFiles.filter((f) => f.status === 'error')
    const succeeded = completedFiles.length - errors.length
    const tokenRate = formatTokenRate(completedOutputTokens, elapsedMs)

    if (errors.length > 0) {
      process.stderr.write('\n')
      for (const f of errors) {
        logErrorLine(f)
      }
    }
    process.stderr.write('\n')

    let summary = `${chalk.green('✓')} ${chalk.bold('完成')}  ${chalk.bold(String(completedFiles.length))} 个文件 · 成功 ${chalk.bold.green(String(succeeded))} · 耗时 ${chalk.bold.green(elapsed)} · ${tokenRate}`
    if (completedChunks > 0) {
      summary += ` · ${completedChunks} 块 · ${completedOutputTokens.toLocaleString('zh-CN')} tokens`
    }
    if (errors.length > 0) {
      summary += ` · ${chalk.bold.red(errors.length + ' 个失败')}`
    }
    process.stderr.write(summary + '\n')
  }

  const callbacks: ProgressCallbacks = {
    onFileStart(file, chunks) {
      const existing = files.get(file)
      if (existing) {
        discoveredChunks += chunks.length - existing.totalChunks
        existing.totalChunks = chunks.length
        existing.chunkSizes = chunks.map((chunk) => chunk.size)
        return
      }

      discoveredChunks += chunks.length
      files.set(file, {
        file,
        totalChunks: chunks.length,
        completedChunks: 0,
        chunkSizes: chunks.map((chunk) => chunk.size),
        activeChunkSizes: [],
        completedChunkSizes: [],
        outputTokens: 0,
        status: 'active',
        startTime: Date.now(),
      })
    },
    onChunkStart(file, chunk) {
      const f = files.get(file)
      if (f) {
        f.activeChunkSizes.push(chunk.size)
      }
    },
    onChunkComplete(file, chunk, outputTokens) {
      const f = files.get(file)
      if (f) {
        f.completedChunks++
        f.completedChunkSizes.push(chunk.size)
        f.outputTokens += outputTokens
        const index = f.activeChunkSizes.indexOf(chunk.size)
        if (index !== -1) {
          f.activeChunkSizes.splice(index, 1)
        }
        completedChunks++
        completedOutputTokens += outputTokens
      }
    },
    onFileComplete(file) {
      const f = files.get(file)
      if (f) {
        f.status = 'done'
        f.endTime = Date.now()
        files.delete(file)
        completedFiles.push(f)
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
        if (!isTTY) logErrorLine(f)
      }
    },
  }

  return {
    start() {
      if (isTTY) {
        process.stderr.write(
          `${chalk.bold('docforge')} ${chalk.dim('·')} ${chalk.dim('实时翻译面板')}\n\n`,
        )
        render()
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
