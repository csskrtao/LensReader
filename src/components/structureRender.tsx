import type { CSSProperties, ReactNode } from 'react';
import type { Structure } from '../lib/structure';

const cvar = (color: string) => ({ '--c': color }) as CSSProperties;

/** 句子成分着色时 token 需要的 class / style / 标签 */
export function tokenStruct(st: Structure, i: number) {
  const g = st.segOf.get(i);
  if (!g) return { cls: [] as string[] };
  const cls = ['comp', g.depth > 0 ? 'inner' : 'outer'];
  if (g.start === i) cls.push('comp-start');
  return { cls, style: cvar(g.color), role: g.start === i ? g.label : undefined, title: g.title };
}

/** token i 与 i+1 之间的空白是否属于同一成分 */
export function wsStruct(st: Structure, i: number) {
  const g = st.segOf.get(i);
  if (!g || st.segOf.get(i + 1) !== g) return { cls: [] as string[] };
  return { cls: ['comp', g.depth > 0 ? 'inner' : 'outer'], style: cvar(g.color) };
}

export function clauseOpens(st: Structure, i: number): ReactNode[] {
  return (st.opens.get(i) || []).map((cl, k) => (
    <span key={'co' + i + '-' + k} className="clause-br open" style={cvar(cl.color)} data-role={cl.label}>
      [
    </span>
  ));
}

export function clauseCloses(st: Structure, i: number): ReactNode[] {
  return (st.closes.get(i) || []).map((cl, k) => (
    <span key={'cc' + i + '-' + k} className="clause-br close" style={cvar(cl.color)}>
      ]
    </span>
  ));
}

/** 成分起始词：用 <ruby> 把标签放在上方，浏览器会自动撑开宽度，标签不会互相重叠 */
export function withLabel(key: string | number, node: ReactNode, role: string | undefined, style?: CSSProperties): ReactNode {
  if (!role) return node;
  return (
    <ruby key={'rb' + key} className="comp-ruby" style={style}>
      {node}
      <rt>{role}</rt>
    </ruby>
  );
}
