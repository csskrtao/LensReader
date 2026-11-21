import type { Comp, Doc } from '../types';

export interface RoleInfo {
  label: string;
  color: string;
}

const C = {
  subj: '#2563eb',
  pred: '#dc2626',
  obj: '#16a34a',
  pc: '#0d9488',
  comp: '#ca8a04',
  attr: '#9333ea',
  adv: '#ea580c',
  appo: '#db2777',
  gray: '#64748b',
};

// 规范角色名（提示词要求模型只用这些）
const EXACT: Record<string, RoleInfo> = {
  主语: { label: '主语', color: C.subj },
  谓语: { label: '谓语', color: C.pred },
  宾语: { label: '宾语', color: C.obj },
  间接宾语: { label: '间宾', color: C.obj },
  直接宾语: { label: '直宾', color: C.obj },
  表语: { label: '表语', color: C.pc },
  宾语补足语: { label: '宾补', color: C.comp },
  定语: { label: '定语', color: C.attr },
  状语: { label: '状语', color: C.adv },
  同位语: { label: '同位语', color: C.appo },
  插入语: { label: '插入语', color: C.gray },
  连接词: { label: '连接词', color: C.gray },
  引导词: { label: '引导词', color: C.gray },
};

// 兜底的模糊匹配：「主语」放最后，避免把「状语（逻辑主语是…）」之类误判成主语
const FUZZY: [RegExp, string][] = [
  [/补/, '宾语补足语'],
  [/同位/, '同位语'],
  [/状语/, '状语'],
  [/定语/, '定语'],
  [/表语/, '表语'],
  [/引导|关系代词|关系副词/, '引导词'],
  [/宾语/, '宾语'],
  [/谓语|系动词|助动词|情态/, '谓语'],
  [/插入/, '插入语'],
  [/连/, '连接词'],
  [/主语/, '主语'],
];

export function roleInfo(role: string): RoleInfo {
  const r = role.trim();
  if (EXACT[r]) return EXACT[r];
  for (const [re, key] of FUZZY) if (re.test(r)) return EXACT[key];
  return { label: r.slice(0, 4) || '其他', color: C.gray };
}

/** 带 parts 的成分（从句）显示用的名称，如「宾语从句」 */
export function clauseLabel(role: string): string {
  const info = roleInfo(role);
  const base = { 间宾: '宾语', 直宾: '宾语', 宾补: '宾补' }[info.label] || info.label;
  return base.endsWith('从句') ? base : base + '从句';
}

/** 从句内部成分的显示名，如「从句主语」；引导词/连接词不加前缀 */
export function innerLabel(info: RoleInfo): string {
  return ['引导词', '连接词', '插入语'].includes(info.label) ? info.label : '从句' + info.label;
}

export interface Segment {
  start: number; // 全局 token 下标（含）
  end: number;
  depth: number; // 0 = 主句层面；>=1 = 在从句内部
  label: string;
  color: string;
  title: string;
}

export interface Clause {
  start: number;
  end: number;
  depth: number;
  label: string;
  color: string;
}

export interface Structure {
  segs: Segment[];
  clauses: Clause[];
  segOf: Map<number, Segment>;
  opens: Map<number, Clause[]>; // 在该 token 之前插入的左括号
  closes: Map<number, Clause[]>; // 在该 token 之后插入的右括号
}

export const EMPTY_STRUCTURE: Structure = { segs: [], clauses: [], segOf: new Map(), opens: new Map(), closes: new Map() };

const WORD_RE = /[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu;
const norm = (w: string) => w.toLowerCase().replace(/’/g, "'");
const wordsOf = (text: unknown) => (String(text || '').match(WORD_RE) || []).map(norm);

/** 把模型给出的（可嵌套的）成分树对应到原句中的 token 范围；对不上的片段跳过 */
export function buildStructure(doc: Doc, sid: string, components: Comp[] | undefined): Structure {
  const sen = doc.sentences.get(sid);
  if (!sen || !Array.isArray(components) || !components.length) return EMPTY_STRUCTURE;

  const words: { i: number; w: string }[] = [];
  for (let i = sen.start; i <= sen.end; i++) {
    if (doc.tokens[i].isWord) words.push({ i, w: norm(doc.tokens[i].text) });
  }
  const used = new Array(words.length).fill(false);
  const segs: Segment[] = [];
  const clauses: Clause[] = [];
  let cursor = 0;

  const findAt = (target: string[], from: number, checkUsed: boolean): number => {
    for (let k = from; k + target.length <= words.length; k++) {
      let hit = true;
      for (let j = 0; j < target.length; j++) {
        if ((checkUsed && used[k + j]) || words[k + j].w !== target[j]) {
          hit = false;
          break;
        }
      }
      if (hit) return k;
    }
    return -1;
  };
  const find = (target: string[], checkUsed: boolean) => {
    const k = findAt(target, cursor, checkUsed);
    return k >= 0 ? k : findAt(target, 0, checkUsed);
  };

  const walk = (nodes: Comp[], depth: number) => {
    for (const c of nodes) {
      if (!c) continue;
      const target = wordsOf(c.text);
      const role = String(c.role || '');
      const parts = Array.isArray(c.parts) && c.parts.length ? c.parts : null;
      if (parts) {
        const k = target.length ? find(target, true) : -1;
        if (k >= 0) {
          clauses.push({
            start: words[k].i,
            end: words[k + target.length - 1].i,
            depth,
            label: clauseLabel(role),
            color: roleInfo(role).color,
          });
          cursor = k;
        }
        walk(parts, depth + 1);
        continue;
      }
      if (!target.length) continue;
      const k = find(target, true);
      if (k < 0) continue;
      for (let j = 0; j < target.length; j++) used[k + j] = true;
      cursor = k + target.length;
      const info = roleInfo(role);
      segs.push({
        start: words[k].i,
        end: words[k + target.length - 1].i,
        depth,
        label: depth > 0 ? innerLabel(info) : info.label,
        color: info.color,
        title: [c.zh, c.detail].filter(Boolean).join('；') || role,
      });
    }
  };
  walk(components, 0);

  const segOf = new Map<number, Segment>();
  for (const g of segs) for (let i = g.start; i <= g.end; i++) segOf.set(i, g);
  const opens = new Map<number, Clause[]>();
  const closes = new Map<number, Clause[]>();
  // 外层括号先开后关
  for (const cl of [...clauses].sort((a, b) => a.depth - b.depth)) {
    opens.set(cl.start, [...(opens.get(cl.start) || []), cl]);
  }
  for (const cl of [...clauses].sort((a, b) => b.depth - a.depth)) {
    closes.set(cl.end, [...(closes.get(cl.end) || []), cl]);
  }
  return { segs, clauses, segOf, opens, closes };
}
