import type { Root, RootContent } from 'mdast'
import remarkFrontmatter from 'remark-frontmatter'
import remarkMdc from 'remark-mdc'
import remarkMdx from 'remark-mdx'
import remarkParse from 'remark-parse'
import remarkStringify from 'remark-stringify'
import { unified } from 'unified'

// 不需要翻译的节点类型（纯编程结构）
const NON_TRANSLATABLE_TYPES = new Set([
  'mdxjsEsm', // MDX import/export
  'mdxFlowExpression', // MDX JS 表达式
])

function isTranslatable(node: RootContent): boolean {
  return !NON_TRANSLATABLE_TYPES.has(node.type)
}

interface Chunk {
  start: number
  end: number
  translatable: boolean
}

function splitIntoChunks(
  root: Root,
  maxChunkSize: number,
  minChunkSize: number,
): Chunk[] {
  const chunks: Chunk[] = []
  let currentStart = -1
  let currentEnd = -1

  for (const node of root.children) {
    if (!node.position) continue

    const nodeStart = node.position.start.offset!
    const nodeEnd = node.position.end.offset!

    if (!isTranslatable(node)) {
      // 刷出当前可翻译的 chunk
      if (currentStart >= 0) {
        chunks.push({
          start: currentStart,
          end: currentEnd,
          translatable: true,
        })
        currentStart = -1
        currentEnd = -1
      }
      // 不可翻译的节点作为独立 chunk
      chunks.push({ start: nodeStart, end: nodeEnd, translatable: false })
    } else {
      if (currentStart < 0) {
        // 开始新的可翻译 chunk
        currentStart = nodeStart
        currentEnd = nodeEnd
      } else if (
        nodeEnd - currentStart > maxChunkSize ||
        (node.type === 'heading' &&
          node.depth <= 2 &&
          currentEnd - currentStart >= minChunkSize)
      ) {
        // 当前 chunk 超过最大限制，或遇到 1-2 级标题且已达到最小分片大小，刷出
        chunks.push({
          start: currentStart,
          end: currentEnd,
          translatable: true,
        })
        currentStart = nodeStart
        currentEnd = nodeEnd
      } else {
        // 扩展当前 chunk（包含节点间的空白）
        currentEnd = nodeEnd
      }
    }
  }

  // 刷出最后一个 chunk
  if (currentStart >= 0) {
    chunks.push({ start: currentStart, end: currentEnd, translatable: true })
  }

  return chunks
}

function createProcessor(filePath?: string) {
  const processor = unified()
    .use(remarkParse)
    .use(remarkFrontmatter, ['yaml', 'toml'])

  if (filePath?.endsWith('.mdx')) {
    processor.use(remarkMdx)
  } else {
    processor.use(remarkMdc)
  }

  return processor.use(remarkStringify)
}

export function processChunkOutput(output: string): string {
  let result = output.trim()

  if (
    result.startsWith('```markdown') ||
    result.startsWith('```mdx') ||
    result.startsWith('```md')
  ) {
    const i = result.indexOf('\n')
    if (i !== -1) {
      result = result.slice(i + 1)
      if (result.endsWith('```')) {
        result = result.slice(0, -3).trimEnd()
      }
    }
  }

  return result
}

export async function translateByChunks(
  content: string,
  translateFn: (text: string) => Promise<string>,
  options: {
    maxChunkSize?: number
    minChunkSize?: number
    filePath?: string
  } = {},
): Promise<string> {
  const { maxChunkSize = 50000, minChunkSize = 10000, filePath } = options
  const processor = createProcessor(filePath)

  const tree = processor.parse(content) as Root
  const chunks = splitIntoChunks(tree, maxChunkSize, minChunkSize)

  if (chunks.length === 0) {
    return content
  }

  const translatedChunks = await Promise.all(
    chunks.map(async (chunk) => {
      const chunkText = content.slice(chunk.start, chunk.end)

      if (!chunk.translatable) {
        return chunkText
      }

      const translated = await translateFn(chunkText)
      return processChunkOutput(translated)
    }),
  )

  const parts: string[] = []
  let lastEnd = 0

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]

    // 保留 chunk 之间的空白内容
    if (chunk.start > lastEnd) {
      parts.push(content.slice(lastEnd, chunk.start))
    }
    parts.push(translatedChunks[i])

    lastEnd = chunk.end
  }

  // 保留尾部内容（如末尾换行符）
  if (lastEnd < content.length) {
    parts.push(content.slice(lastEnd))
  }

  return parts.join('')
}
