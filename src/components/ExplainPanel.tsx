import { useState, type CSSProperties, type ReactNode } from 'react';
import { clauseCloses, clauseOpens, tokenStruct, withLabel, wsStruct } from './structureRender';
import { clauseLabel, innerLabel, roleInfo, type Structure } from '../lib/structure';
import type { Comp, Doc, Layout, PanelState, QuickResult, RangeExp, SentenceExp, VocabKind, WordExp } from '../types';

interface Props {
  panel: PanelState;
  doc: Doc;
  layout: Layout;
  structure: Structure;
  saved: boolean;
  onToggleSave: (kind: VocabKind, text: string, meaning: string, extra?: string) => void;
  onDeleteHighlight: (hid: string) => void;
  onRetry: () => void;
  onClose: () => void;
}

const KIND_LABEL = { word: '单词', sentence: '句子', range: '划线' } as const;

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="ex-sec">
      <h4>{title}</h4>
      {children}
    </section>
  );
}

const has = (a?: unknown[]) => Array.isArray(a) && a.length > 0;

function Examples({ list }: { list?: { en: string; zh: string }[] }) {
  if (!has(list)) return null;
  return (
    <Section title="例句">
      <ul className="examples">
        {list!.map((e, k) => (
          <li key={k}>
            <div className="en">{e.en}</div>
            <div className="zh-s">{e.zh}</div>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function PairList({ list, a, b }: { list?: any[]; a: string; b: string }) {
  if (!has(list)) return null;
  return (
    <ul className="pairs">
      {list!.map((x, k) => (
        <li key={k}>
          <b>{x[a]}</b>
          <span>{x[b]}</span>
        </li>
      ))}
    </ul>
  );
}

/** AI 讲解返回前先显示的词典 / 机翻结果 */
function QuickCard({ q }: { q: QuickResult }) {
  const w = q.word;
  return (
    <div className="quick-card">
      {w ? (
        <>
          <div className="ex-head">
            <span className="ex-title">{w.word}</span>
            {w.phonetic && <span className="phonetic">美 {w.phonetic}</span>}
            {w.ukphonetic && w.ukphonetic !== w.phonetic && <span className="phonetic">英 {w.ukphonetic}</span>}
            <span className="mt-tag">词典</span>
          </div>
          {w.lemma && <p className="muted quick-lemma">原形：{w.lemma}</p>}
          <ul className="quick-means">
            {w.meanings.map((m, k) => (
              <li key={k}>
                {m.pos && <span className="tag">{m.pos}</span>}
                <span>{m.tran}</span>
              </li>
            ))}
          </ul>
          {w.exam.length > 0 && (
            <div className="quick-exam">
              {w.exam.map((e) => (
                <span key={e} className="tag">
                  {e}
                </span>
              ))}
            </div>
          )}
        </>
      ) : (
        <div className="big-zh">
          {q.zh}
          <span className="mt-tag">机翻</span>
        </div>
      )}
    </div>
  );
}

function WordCard({ d }: { d: WordExp }) {
  return (
    <>
      <div className="ex-head">
        <span className="ex-title">{d.word}</span>
        {d.phonetic && <span className="phonetic">{d.phonetic}</span>}
        {d.pos && <span className="tag">{d.pos}</span>}
      </div>
      {d.translation && <div className="big-zh">{d.translation}</div>}
      {d.meaning_in_context && <Section title="在本句中">{<p>{d.meaning_in_context}</p>}</Section>}
      {has(d.other_meanings) && (
        <Section title="其他释义">
          <PairList list={d.other_meanings} a="pos" b="meaning" />
        </Section>
      )}
      {has(d.collocations) && (
        <Section title="常用搭配">
          <PairList list={d.collocations} a="phrase" b="meaning" />
        </Section>
      )}
      <Examples list={d.examples} />
      {d.note && <Section title="补充">{<p>{d.note}</p>}</Section>}
    </>
  );
}

/** 按成分上色的原句 */
function StructuredQuote({ doc, sid, st }: { doc: Doc; sid: string; st: Structure }) {
  const sen = doc.sentences.get(sid);
  if (!sen) return null;
  const nodes: ReactNode[] = [];
  for (let i = sen.start; i <= sen.end; i++) {
    const t = doc.tokens[i];
    const ts = tokenStruct(st, i);
    nodes.push(...clauseOpens(st, i));
    nodes.push(
      withLabel(
        i,
        <span key={i} className={['tok', ...ts.cls].join(' ')} style={ts.style} title={ts.title}>
          {t.text}
        </span>,
        ts.role,
        ts.style,
      ),
    );
    nodes.push(...clauseCloses(st, i));
    if (t.ws && i < sen.end) {
      const ws = wsStruct(st, i);
      nodes.push(
        <span key={'w' + i} className={['ws', ...ws.cls].join(' ')} style={ws.style}>
          {t.ws}
        </span>,
      );
    }
  }
  return <p className="quote structured">{nodes}</p>;
}

/** 成分树：从句展开为缩进的子列表 */
function CompTree({ list, depth }: { list: Comp[]; depth: number }) {
  return (
    <ul className={depth ? 'components nested' : 'components'}>
      {list.map((c, k) => {
        const role = String(c.role || '');
        const r = roleInfo(role);
        const isClause = Array.isArray(c.parts) && c.parts.length > 0;
        const label = isClause ? clauseLabel(role) : depth > 0 ? innerLabel(r) : r.label;
        return (
          <li key={k} style={{ '--c': r.color } as CSSProperties}>
            <span className={isClause ? 'tag role clause' : depth > 0 ? 'tag role inner' : 'tag role'}>{label}</span>
            <div className="comp-body">
              <span className={isClause ? 'en' : 'en comp-text'}>{c.text}</span>
              {c.zh && <span className="comp-zh">{c.zh}</span>}
              {c.detail && <span className="muted small comp-detail">{c.detail}</span>}
              {isClause && <CompTree list={c.parts!} depth={depth + 1} />}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function SentenceCard({ d, text, doc, sid, st }: { d: SentenceExp; text: string; doc: Doc; sid: string; st: Structure }) {
  return (
    <>
      {st.segs.length ? <StructuredQuote doc={doc} sid={sid} st={st} /> : <p className="quote">{text}</p>}
      {d.translation && <div className="big-zh">{d.translation}</div>}
      {d.structure && <Section title="句子结构">{<p>{d.structure}</p>}</Section>}
      {has(d.components) && (
        <Section title="成分拆分">
          <CompTree list={d.components!} depth={0} />
        </Section>
      )}
      {has(d.grammar) && (
        <Section title="语法点">
          <PairList list={d.grammar} a="point" b="explanation" />
        </Section>
      )}
      {has(d.phrases) && (
        <Section title="重点表达">
          <PairList list={d.phrases} a="phrase" b="meaning" />
        </Section>
      )}
    </>
  );
}

function RangeCard({ d, text }: { d: RangeExp; text: string }) {
  return (
    <>
      <div className="ex-head">
        <span className="ex-title">{text}</span>
        {d.type && <span className="tag">{d.type}</span>}
      </div>
      {d.translation && <div className="big-zh">{d.translation}</div>}
      {d.meaning_in_context && <Section title="在本句中">{<p>{d.meaning_in_context}</p>}</Section>}
      {d.pattern && (
        <Section title="固定搭配结构">
          <p className="pattern">{d.pattern}</p>
        </Section>
      )}
      {d.usage && <Section title="用法">{<p>{d.usage}</p>}</Section>}
      {has(d.extended_meanings) && (
        <Section title="拓展意思">
          <ul className="examples">
            {d.extended_meanings!.map((x, k) => (
              <li key={k}>
                <div>
                  <b>{x.meaning}</b>
                </div>
                {x.example && <div className="en">{x.example}</div>}
                {x.example_zh && <div className="zh-s">{x.example_zh}</div>}
              </li>
            ))}
          </ul>
        </Section>
      )}
      {has(d.similar) && (
        <Section title="近义 / 相关表达">
          <PairList list={d.similar} a="phrase" b="meaning" />
        </Section>
      )}
      <Examples list={d.examples} />
      {d.note && <Section title="补充">{<p>{d.note}</p>}</Section>}
    </>
  );
}

export default function ExplainPanel({ panel, doc, layout, structure, saved, onToggleSave, onDeleteHighlight, onRetry, onClose }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const { target, data, loading, error, quick } = panel;

  const headText =
    target.kind === 'word'
      ? target.word
      : target.kind === 'range'
        ? target.text
        : doc.sentences.get(target.sid)?.text || '';

  /** 拖动面板边缘调整大小：左右布局调宽度，上下布局调高度 */
  function startResize(e: React.PointerEvent) {
    e.preventDefault();
    const side = layout === 'side' && window.innerWidth >= 900;
    const prop = side ? '--side-w' : '--panel-h';
    const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
    // 按拖动位移计算，避免按下瞬间跳动
    const rect = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
    const start = side ? e.clientX : e.clientY;
    const size0 = side ? rect.width : rect.height;
    let value = '';
    const move = (ev: PointerEvent) => {
      value = side
        ? clamp(size0 + start - ev.clientX, 320, window.innerWidth * 0.7) + 'px'
        : clamp(size0 + start - ev.clientY, 140, window.innerHeight * 0.85) + 'px';
      document.documentElement.style.setProperty(prop, value);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.classList.remove('resizing');
      if (value) localStorage.setItem('er:' + prop, value);
    };
    document.body.classList.add('resizing');
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  function save() {
    if (!data) {
      // 只有快速结果时也能收藏，释义取词典 / 机翻
      if (!quick) return;
      if (target.kind === 'word' && quick.word) {
        const w = quick.word;
        const meaning = w.meanings.map((m) => (m.pos ? m.pos + ' ' : '') + m.tran).join('；');
        onToggleSave('word', w.lemma || target.word, meaning, w.phonetic);
      } else if (quick.zh) {
        onToggleSave(target.kind === 'range' ? 'phrase' : 'sentence', headText, quick.zh);
      }
      return;
    }
    if (target.kind === 'word') {
      const d = data as WordExp;
      onToggleSave('word', d.word || target.word, d.translation || '', [d.phonetic, d.pos].filter(Boolean).join(' '));
    } else if (target.kind === 'range') {
      const d = data as RangeExp;
      onToggleSave('phrase', target.text, d.translation || '', d.type);
    } else {
      onToggleSave('sentence', headText, (data as SentenceExp).translation || '');
    }
  }

  return (
    <div className={`panel ${collapsed ? 'collapsed' : ''}`}>
      {!collapsed && <div className="panel-resize" onPointerDown={startResize} title="拖动调整大小" />}
      <div className="panel-bar">
        <span className="tag kind">{KIND_LABEL[target.kind]}</span>
        <span className="panel-text" title={headText}>
          {headText}
        </span>
        <div className="panel-actions">
          {(data || quick) && (
            <button className={saved ? 'btn small on' : 'btn small'} onClick={save}>
              {saved ? '★ 已收藏' : '☆ 加入生词本'}
            </button>
          )}
          {target.kind === 'range' && (
            <button className="btn small danger" onClick={() => onDeleteHighlight(target.hid)}>
              删除划线
            </button>
          )}
          <button className="btn small ghost" onClick={() => setCollapsed((c) => !c)}>
            {collapsed ? '展开' : '收起'}
          </button>
          <button className="btn small ghost" onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </div>
      </div>
      {!collapsed && (
        <div className="panel-body">
          {quick && !data && <QuickCard q={quick} />}
          {loading &&
            (quick ? (
              <div className="skeleton compact">
                <div />
                <p className="muted">AI 正在精讲……</p>
              </div>
            ) : (
              <div className="skeleton">
                <div />
                <div />
                <div />
                <p className="muted">AI 正在讲解……</p>
              </div>
            ))}
          {error && (
            <div className="error">
              <p>出错了：{error}</p>
              <button className="btn small" onClick={onRetry}>
                重试
              </button>
            </div>
          )}
          {data && target.kind === 'word' && <WordCard d={data} />}
          {data && target.kind === 'sentence' && (
            <SentenceCard d={data} text={headText} doc={doc} sid={target.sid} st={structure} />
          )}
          {data && target.kind === 'range' && <RangeCard d={data} text={target.text} />}
        </div>
      )}
    </div>
  );
}
