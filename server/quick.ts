/**
 * 快速结果：AI 讲解返回前先垫上一个简单结果，失败时前端静默忽略。
 * - 单词：有道词典（音标、按词性释义、考试标签、原形）
 * - 句子 / 片段 / 逐句翻译：有道翻译（同一个词典接口传整句时返回的 fanyi 字段）
 * - 兜底：谷歌翻译网页接口（Cloudflare 出口 IP 会被谷歌限流 429，主要在本地生效）
 * 都是非官方免 Key 接口。只用全局 fetch，本地 Express 与 Cloudflare Worker 共用。
 */

export interface QuickWord {
  word: string;
  lemma?: string; // 词形变化的原形，如 running → run
  phonetic?: string; // 美式音标
  ukphonetic?: string;
  meanings: { pos: string; tran: string }[];
  exam: string[];
}

const TIMEOUT = 8000;
/** 两个接口对没有 UA 的请求响应明显变慢，带上常见浏览器 UA */
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
/** 前端单次最多发来的句数 */
export const QUICK_BATCH = 25;
/** 有道单次翻译超过约 650 字符会截断，按 500 字符分组 */
const YOUDAO_CHARS = 500;

const YOUDAO = 'https://dict.youdao.com/jsonapi_s?doctype=json&jsonversion=4';
const GOOGLE = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=zh-CN&dt=t';

async function postForm(url: string, q: string): Promise<any> {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', 'User-Agent': UA },
    body: 'q=' + encodeURIComponent(q),
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

/** 有道：查词时返回 ec（词典），传句子时返回 fanyi（机翻）；多行文本按行翻译 */
const youdao = (q: string) => postForm(YOUDAO, q);

async function youdaoTranslate(text: string): Promise<string> {
  const tran = (await youdao(text))?.fanyi?.tran;
  if (typeof tran !== 'string' || !tran.trim()) throw new Error('有道翻译没有返回结果');
  return tran;
}

async function googleTranslate(text: string): Promise<string> {
  const j = await postForm(GOOGLE, text);
  if (!Array.isArray(j?.[0])) throw new Error('谷歌翻译返回格式异常');
  return j[0].map((seg: any) => (typeof seg?.[0] === 'string' ? seg[0] : '')).join('');
}

/** 翻译一句：有道失败时用谷歌 */
async function translateOne(text: string): Promise<string> {
  try {
    return (await youdaoTranslate(text)).trim();
  } catch {
    return (await googleTranslate(text)).trim();
  }
}

/** 批量翻译：按字符数分组，每组多句用换行拼成一次请求；行数对不上的句子逐句补翻 */
export async function quickTranslate(items: { id: string; text: string }[]): Promise<Record<string, string>> {
  const list = items
    .slice(0, QUICK_BATCH)
    .map((it) => ({ id: String(it.id), text: String(it.text).replace(/\s+/g, ' ').trim() }))
    .filter((x) => x.text);
  const out: Record<string, string> = {};

  const groups: (typeof list)[] = [];
  let cur: typeof list = [];
  let len = 0;
  for (const x of list) {
    if (cur.length && len + x.text.length > YOUDAO_CHARS) {
      groups.push(cur);
      cur = [];
      len = 0;
    }
    cur.push(x);
    len += x.text.length + 1;
  }
  if (cur.length) groups.push(cur);

  await Promise.all(
    groups.map(async (g) => {
      let rest = g;
      if (g.length > 1) {
        try {
          const lines = (await youdaoTranslate(g.map((x) => x.text).join('\n'))).split('\n');
          if (lines.length === g.length) {
            g.forEach((x, i) => lines[i].trim() && (out[x.id] = lines[i].trim()));
            rest = g.filter((x) => !out[x.id]);
          }
        } catch {
          /* 整组失败：逐句补翻 */
        }
      }
      const zh = await Promise.all(rest.map((x) => translateOne(x.text).catch(() => '')));
      rest.forEach((x, i) => zh[i] && (out[x.id] = zh[i]));
    }),
  );
  return out;
}

/** 有道词典查词；查不到释义时用有道 / 谷歌的机翻兜底 */
export async function quickWord(raw: string): Promise<QuickWord> {
  const word = raw.trim().slice(0, 64);
  const res: QuickWord = { word, meanings: [], exam: [] };
  try {
    const j = await youdao(word.toLowerCase());
    const w = j?.ec?.word;
    if (w) {
      if (w.usphone) res.phonetic = `/${w.usphone}/`;
      if (w.ukphone) res.ukphonetic = `/${w.ukphone}/`;
      res.meanings = (Array.isArray(w.trs) ? w.trs : [])
        .map((t: any) => ({ pos: String(t?.pos || ''), tran: String(t?.tran || '').trim() }))
        // 去掉人名 / 地名之类的「【名】」词条（如 running 的「朗宁（人名）」）
        .filter((t: { tran: string }) => t.tran && !t.tran.startsWith('【名】'))
        .slice(0, 6);
      const proto = typeof w.prototype === 'string' ? w.prototype.trim() : '';
      if (proto && proto.toLowerCase() !== word.toLowerCase()) res.lemma = proto;
    }
    if (Array.isArray(j?.ec?.exam_type)) res.exam = j.ec.exam_type.map(String).slice(0, 8);
    const fy = j?.fanyi?.tran;
    if (!res.meanings.length && typeof fy === 'string' && fy.trim()) res.meanings = [{ pos: '', tran: fy.trim() }];
  } catch (e: any) {
    console.warn('[quick/word] 有道词典失败：', e?.message || e);
  }
  if (!res.meanings.length) {
    const zh = (await googleTranslate(word)).trim();
    if (zh && zh.toLowerCase() !== word.toLowerCase()) res.meanings = [{ pos: '', tran: zh }];
  }
  if (!res.meanings.length) throw new Error('没有查到释义');
  return res;
}
