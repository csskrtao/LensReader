import type { Article } from '../types';

interface ListProps {
  articles: Article[];
  currentId?: string;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
}

const fmt = (t: number) => new Date(t).toLocaleString('zh-CN', { hour12: false }).slice(0, -3);

export function HistoryList({ articles, currentId, onOpen, onDelete }: ListProps) {
  if (!articles.length) return <p className="muted center">还没有记录</p>;
  return (
    <ul className="history">
      {articles.map((a) => (
        <li key={a.id} className={a.id === currentId ? 'current' : ''} onClick={() => onOpen(a.id)}>
          {a.thumb ? <img src={a.thumb} alt="" /> : <div className="thumb-ph">Aa</div>}
          <div className="h-info">
            <div className="h-title">{a.title}</div>
            <div className="muted small">
              {fmt(a.createdAt)} · {(a.pages ?? 1) > 1 ? `${a.pages} 页 · ` : ''}
              {a.paragraphs.flat().length} 句 · {a.highlights.length} 处划线
            </div>
          </div>
          <button
            className="btn small ghost danger"
            onClick={(e) => {
              e.stopPropagation();
              if (confirm(`删除「${a.title}」？`)) onDelete(a.id);
            }}
          >
            删除
          </button>
        </li>
      ))}
    </ul>
  );
}

export default function HistoryDrawer(props: ListProps & { onClose: () => void }) {
  return (
    <div className="drawer-mask" onClick={props.onClose}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <h3>历史记录</h3>
          <button className="btn small ghost" onClick={props.onClose}>
            ✕
          </button>
        </div>
        <HistoryList {...props} />
      </aside>
    </div>
  );
}
