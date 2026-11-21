import OpenAI from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';

export interface LLMConfig {
  apiKey?: string;
  baseURL?: string;
  textModel?: string;
  visionModel?: string;
}

export interface LLM {
  textModel: string;
  visionModel: string;
  callJSON(model: string, messages: ChatCompletionMessageParam[]): Promise<any>;
}

/** 按配置创建模型客户端（Node 端读 process.env，Cloudflare Worker 端读 env 绑定） */
export function createLLM(cfg: LLMConfig): LLM {
  const textModel = cfg.textModel || 'gpt-4o-mini';
  const visionModel = cfg.visionModel || cfg.textModel || 'gpt-4o';
  let client: OpenAI | null = null;

  function getClient(): OpenAI {
    if (!client) {
      const baseURL = cfg.baseURL || undefined;
      if (!cfg.apiKey && !baseURL) {
        throw new Error('未配置 OPENAI_API_KEY：本地请在 .env 中填写，Cloudflare 请用 wrangler secret put 设置');
      }
      client = new OpenAI({ apiKey: cfg.apiKey || 'not-needed', baseURL, timeout: 120_000, maxRetries: 2 });
    }
    return client;
  }

  /** 调用模型并把回复解析成 JSON。优先用 json_object 模式，服务不支持时退回普通模式。 */
  async function callJSON(model: string, messages: ChatCompletionMessageParam[]): Promise<any> {
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

  return { textModel, visionModel, callJSON };
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
