import { useMemo, useState } from 'react';
import type { VocabItem, VocabKind } from '../types';

interface Props {
  items: VocabItem[];
  onRemove: (id: string) => void;
  onJump: (item: VocabItem) => void;
}

const TABS: { key: VocabKind | 'all'; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'word', label: '单词' },
  { key: 'phrase', label: '短语/搭配' },
  { key: 'sentence', label: '句子' },
];

export default function VocabBook({ items, onRemove, onJump }: Props) {
  const [tab, setTab] = useState<VocabKind | 'all'>('all');
  const [q, setQ] = useState('');

  const list = useMemo(() => {
    const k = q.trim().toLowerCase();
    return items.filter(
      (v) =>
        (tab === 'all' || v.kind === tab) &&
        (!k || v.text.toLowerCase().includes(k) || v.meaning.toLowerCase().includes(k)),
    );
  }, [items, tab, q]);

  return (
    <div className="vocab">
      <div className="vocab-tools">
        <div className="seg">
          {TABS.map((t) => (
            <button key={t.key} className={tab === t.key ? 'on' : ''} onClick={() => setTab(t.key)}>
              {t.label}
              <span className="count">{t.key === 'all' ? items.length : items.filter((v) => v.kind === t.key).length}</span>
            </button>
          ))}
        </div>
        <input className="search" placeholder="搜索英文或中文…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {!list.length && <p className="muted center">{items.length ? '没有匹配的条目' : '生词本是空的：在讲解面板里点「加入生词本」即可收藏'}</p>}
      <ul className="vocab-list">
        {list.map((v) => (
          <li key={v.id}>
            <div className="v-main">
              <span className={v.kind === 'sentence' ? 'v-text sentence' : 'v-text'}>{v.text}</span>
              {v.extra && <span className="muted small">{v.extra}</span>}
            </div>
            <div className="v-meaning">{v.meaning}</div>
            {v.kind !== 'sentence' && v.context && <div className="v-context">“{v.context}”</div>}
            <div className="v-foot">
              <button className="link" onClick={() => onJump(v)}>
                ↩ {v.articleTitle}
              </button>
              <button className="btn small ghost danger" onClick={() => onRemove(v.id)}>
                删除
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
