# Docforge

面向 Markdown 和 MDX 文档仓库的 LLM 翻译命令行工具。它会按文档结构和 token 数量分块处理文件，并保留原有的 Markdown、MDX 与前置元数据结构。

## 初始化配置

```bash
docforge init
```

配置文件默认写入 `~/.config/docforge/config.json`：

```json
{
  "base_url": "https://gateway.ikxin.com",
  "model": "gpt-6-luna",
  "api_key": "sk-你的密钥"
}
```

## 使用

翻译单个文件：

```bash
docforge path/to/document.md
```

翻译目录中的 Markdown 和 MDX 文件：

```bash
docforge path/to/docs
```

处理 Git 合并状态中的文档冲突：

```bash
docforge merge
```

项目要求 Node.js 22 或更高版本。
