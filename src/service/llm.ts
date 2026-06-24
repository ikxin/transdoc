import OpenAI from 'openai'
import { loadConfig, type RawConfig } from '../config/index.ts'
import { USER_AGENT } from '../config/constants.ts'

export function createClient(config: RawConfig): OpenAI {
  return new OpenAI({
    apiKey: config.api_key,
    baseURL: config.base_url,
    defaultHeaders: {
      'User-Agent': USER_AGENT,
    },
  })
}

export function resolveClient(): {
  client: OpenAI
  model: string
} {
  const config = loadConfig()
  const client = createClient(config)

  return {
    client,
    model: config.model,
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
