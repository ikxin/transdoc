export const DEFAULT_CHUNKED = true
export const DEFAULT_QUEUE = 10
export const USER_AGENT = 'claude-cli/2.1.126 (external, cli)'

export const SYSTEM_PROMPT = `将以下 markdown 格式的内容翻译成中文，请遵守以下规则：
1. 严格保持原文的 markdown 格式和结构不变
2. 代码块中只翻译注释内容，不要修改任何代码、变量名、函数名、关键字
3. HTML 中只翻译文本内容，不要修改标签名、属性名、属性值（除非属性值是面向用户的文案）
4. 直接输出翻译结果，不要用代码块包裹，不要添加任何额外的解释内容`

export const IGNORED_FILES = [
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
