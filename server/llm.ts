import OpenAI from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';

let client: OpenAI | null = null;

export const textModel = () => process.env.TEXT_MODEL || 'gpt-4o-mini';
export const visionModel = () => process.env.VISION_MODEL || process.env.TEXT_MODEL || 'gpt-4o';

function getClient(): OpenAI {
  if (!client) {
    const apiKey = process.env.OPENAI_API_KEY;
    const baseURL = process.env.OPENAI_BASE_URL || undefined;
    if (!apiKey && !baseURL) {
      throw new Error('未配置 OPENAI_API_KEY：请在项目根目录的 .env 中填写');
    }
    client = new OpenAI({ apiKey: apiKey || 'not-needed', baseURL, timeout: 120_000, maxRetries: 2 });
  }
  return client;
}

/** 调用模型并把回复解析成 JSON。优先用 json_object 模式，服务不支持时退回普通模式。 */
export async function callJSON(model: string, messages: ChatCompletionMessageParam[]): Promise<any> {
  const c = getClient();
  let content: string | null | undefined;
  try {
    const r = await c.chat.completions.create({ model, messages, response_format: { type: 'json_object' } });
    content = r.choices[0]?.message?.content;
  } catch (e) {
    if (e instanceof OpenAI.APIError && (e.status === 400 || e.status === 422)) {
      const r = await c.chat.completions.create({ model, messages });
      content = r.choices[0]?.message?.content;
    } else {
      throw e;
    }
  }
  if (!content) throw new Error('模型没有返回内容');
  return parseJSON(content);
}

export function parseJSON(raw: string): any {
  const t = raw
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '');
  try {
    return JSON.parse(t);
  } catch {
    const a = t.indexOf('{');
    const b = t.lastIndexOf('}');
    if (a >= 0 && b > a) {
      try {
        return JSON.parse(t.slice(a, b + 1));
      } catch {
        /* fall through */
      }
    }
  }
  throw new Error('模型返回的不是合法 JSON：' + raw.slice(0, 200));
}
