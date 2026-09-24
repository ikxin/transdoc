export const DEFAULT_CHUNKED = true
export const DEFAULT_QUEUE = 30
export const DEFAULT_RETRIES = 2
export const DEFAULT_MAX_CHUNK_SIZE = 10_000
export const USER_AGENT =
  'Codex Desktop/0.147.0-alpha.6.5 (Mac OS 26.5.2; arm64) unknown (Codex Desktop; 26.803.61601)'

export const SYSTEM_PROMPT = `将以下 Markdown 格式的文档内容翻译成简体中文，必须严格遵守以下规则：
- 保持原文的 Markdown 或 MDX 文档内容的格式和结构不变
- 必须完整输出输入中的全部内容，已经是中文或无需翻译的内容也必须在原位置原样输出
- 如果原文没有末尾的句号，不要擅自加上原文中不存在的句号结尾
- 原文的英文标点符号翻译为中文全角符号，不要添加原文中不存在的符号
- 不要翻译代码块中的内容，不要修改任何代码、变量名、函数名、注释
- 不要翻译原文中的技术专有名词、品牌名、产品名、公司名、人名、地名等
- 原文的英文因为宽度限制导致换行的内容，翻译时将其合并为一行输出
- 直接输出翻译结果，不要用代码块包裹内容，不要添加额外的解释内容`

export const IGNORED_FILES = [
  // 'AGENTS.md',
  // 'CHANGELOG.md',
  // 'CLAUDE.md',
  // 'CODE_OF_CONDUCT.md',
  // 'CONTRIBUTING.md',
  // 'DEVELOPER.md',
  // 'LICENSE.md',
  // 'README.md',
  // 'SECURITY.md',
  // 'SKILL.md',
  // 'VISION.md',
]
