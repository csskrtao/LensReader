import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Structure } from '../lib/structure';
import { clauseCloses, clauseOpens, tokenStruct, withLabel, wsStruct } from './structureRender';
import type { Article, Doc, Mode, Sentence, Target } from '../types';

interface Props {
  doc: Doc;
  article: Article;
  mode: Mode;
  showZh: boolean;
  target: Target | null;
  flashSid: string | null;
  structure: Structure; // 点句时的成分划分（用于在原句中上色）
  onWord: (i: number) => void;
  onSentence: (sid: string) => void;
  onRange: (start: number, end: number) => void;
  onOpenHighlight: (hid: string) => void;
}

const tokenIndexOf = (el: Element | null): number | null => {
  const t = el?.closest<HTMLElement>('[data-i]');
  return t ? Number(t.dataset.i) : null;
};

export default function ArticleView(props: Props) {
  const { doc, article, mode, showZh, target, flashSid, structure } = props;
  const box = useRef<HTMLDivElement>(null);

  // 划线：拖拽中的范围 / “先点起点再点终点”的起点
  const [drag, setDrag] = useState<{ a: number; b: number } | null>(null);
  const [pending, setPending] = useState<number | null>(null);
  const dragRef = useRef(drag);
  const pendingRef = useRef(pending);
  dragRef.current = drag;
  pendingRef.current = pending;
  const cb = useRef(props);
  cb.current = props;

  useEffect(() => setPending(null), [mode, article.id]);

  useEffect(() => {
    const up = () => {
      const d = dragRef.current;
      if (!d) return;
      setDrag(null);
      if (d.a !== d.b) {
        setPending(null);
        cb.current.onRange(Math.min(d.a, d.b), Math.max(d.a, d.b));
      } else if (pendingRef.current == null) {
        setPending(d.a);
      } else {
        const p = pendingRef.current;
        setPending(null);
        cb.current.onRange(Math.min(p, d.a), Math.max(p, d.a));
      }
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPending(null);
        setDrag(null);
      }
    };
    window.addEventListener('pointerup', up);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('pointerup', up);
      window.removeEventListener('keydown', key);
    };
  }, []);

  useEffect(() => {
    if (!flashSid) return;
    box.current?.querySelector(`[data-sid="${flashSid}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [flashSid]);

  // 每个 token 属于哪些划线；每条划线的结束位置放序号标记
  const { hlCount, marks } = useMemo(() => {
    const hlCount = new Map<number, number>();
    const marks = new Map<number, { hid: string; n: number }[]>();
    article.highlights.forEach((h, idx) => {
      for (let i = h.start; i <= h.end; i++) hlCount.set(i, (hlCount.get(i) || 0) + 1);
      const list = marks.get(h.end) || [];
      list.push({ hid: h.id, n: idx + 1 });
      marks.set(h.end, list);
    });
    return { hlCount, marks };
  }, [article.highlights]);

  const inHl = (i: number, j: number) =>
    article.highlights.some((h) => h.start <= i && j <= h.end);

  const selRange: [number, number] | null =
    target?.kind === 'word'
      ? [target.i, target.i]
      : target?.kind === 'range'
        ? [target.start, target.end]
        : null;
  const dragRange: [number, number] | null = drag ? [Math.min(drag.a, drag.b), Math.max(drag.a, drag.b)] : null;
  const within = (r: [number, number] | null, i: number) => !!r && r[0] <= i && i <= r[1];

  function onPointerDown(e: React.PointerEvent) {
    if (mode !== 'range' || e.button !== 0) return;
    if ((e.target as HTMLElement).closest('.hl-mark')) return;
    const i = tokenIndexOf(e.target as Element);
    if (i == null) return;
    e.preventDefault();
    (e.target as Element).releasePointerCapture?.(e.pointerId);
    setDrag({ a: i, b: i });
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!dragRef.current) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || !box.current?.contains(el)) return;
    const i = tokenIndexOf(el);
    if (i != null && i !== dragRef.current.b) setDrag({ a: dragRef.current.a, b: i });
  }

  function onClick(e: React.MouseEvent) {
    const el = e.target as HTMLElement;
    const mark = el.closest<HTMLElement>('.hl-mark');
    if (mark) {
      props.onOpenHighlight(mark.dataset.hid!);
      return;
    }
    if (mode === 'word') {
      const i = tokenIndexOf(el);
      if (i != null && doc.tokens[i].isWord) props.onWord(i);
    } else if (mode === 'sentence') {
      const s = el.closest<HTMLElement>('[data-sid]');
      if (s) props.onSentence(s.dataset.sid!);
    }
  }

  function renderSentence(sen: Sentence): ReactNode {
    const nodes: ReactNode[] = [];
    for (let i = sen.start; i <= sen.end; i++) {
      const t = doc.tokens[i];
      const cls = ['tok'];
      if (t.isWord) cls.push('word');
      if (hlCount.has(i)) cls.push('hl');
      if (within(selRange, i)) cls.push('sel');
      if (within(dragRange, i)) cls.push('drag');
      if (pending === i) cls.push('pending');
      const ts = tokenStruct(structure, i);
      cls.push(...ts.cls);
      nodes.push(...clauseOpens(structure, i));
      nodes.push(
        withLabel(
          i,
          <span key={i} data-i={i} className={cls.join(' ')} style={ts.style} title={ts.title}>
            {t.text}
          </span>,
          ts.role,
          ts.style,
        ),
      );
      for (const m of marks.get(i) || []) {
        nodes.push(
          <sup key={'m' + m.hid} className="hl-mark" data-hid={m.hid} title="查看这条划线的讲解">
            {m.n}
          </sup>,
        );
      }
      nodes.push(...clauseCloses(structure, i));
      if (t.ws && i < sen.end) {
        const wc = ['ws'];
        if (inHl(i, i + 1)) wc.push('hl');
        if (within(selRange, i) && within(selRange, i + 1)) wc.push('sel');
        if (within(dragRange, i) && within(dragRange, i + 1)) wc.push('drag');
        const ws = wsStruct(structure, i);
        wc.push(...ws.cls);
        nodes.push(
          <span key={'w' + i} className={wc.join(' ')} style={ws.style}>
            {t.ws}
          </span>,
        );
      }
    }
    const sc = ['sent'];
    if (target?.kind === 'sentence' && target.sid === sen.id) sc.push('sel-sent');
    if (structure.segs.some((g) => g.start >= sen.start && g.end <= sen.end)) sc.push('structured');
    if (flashSid === sen.id) sc.push('flash');
    return (
      <span data-sid={sen.id} className={sc.join(' ')}>
        {nodes}
      </span>
    );
  }

  return (
    <div
      ref={box}
      className={`article mode-${mode}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onClick={onClick}
    >
      {doc.paragraphs.map((para, p) =>
        showZh ? (
          <div key={p} className="para zh-mode">
            {para.map((sen) => (
              <div key={sen.id} className="sent-block">
                {renderSentence(sen)}
                <div className="zh">{article.translations?.[sen.id] || '（暂无译文）'}</div>
              </div>
            ))}
          </div>
        ) : (
          <p key={p} className="para">
            {para.map((sen, k) => (
              <span key={sen.id}>
                {renderSentence(sen)}
                {k < para.length - 1 ? ' ' : ''}
              </span>
            ))}
          </p>
        ),
      )}
    </div>
  );
}
