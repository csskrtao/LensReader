import type { MobileSession } from './mobile';

export interface Env {
  /** 静态资源（vite build 产物 dist/） */
  ASSETS: Fetcher;
  /** 手机拍照会话，每个会话一个 Durable Object */
  MOBILE: DurableObjectNamespace<MobileSession>;
  OPENAI_API_KEY?: string;
  OPENAI_BASE_URL?: string;
  TEXT_MODEL?: string;
  VISION_MODEL?: string;
  /** 访问口令（wrangler secret put ACCESS_CODE）；不设置则不校验 */
  ACCESS_CODE?: string;
}
