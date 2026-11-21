import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { api, QUICK_BATCH } from './api';
import ArticleView from './components/ArticleView';
import ExplainPanel from './components/ExplainPanel';
import HistoryDrawer, { HistoryList } from './components/HistoryDrawer';
import PhoneLink from './components/PhoneLink';
import Uploader from './components/Uploader';
import VocabBook from './components/VocabBook';
import { prepareImage } from './lib/image';
import { mapLimit, mergePages } from './lib/merge';
import { store } from './lib/store';
import { buildStructure, EMPTY_STRUCTURE } from './lib/structure';
import { buildDoc, contextOf, surroundingOf, textOf, uid } from './lib/tokenize';
import type { Article, Layout, Mode, OcrPage, PanelState, PendingPage, QuickResult, Target, VocabItem, VocabKind } from './types';

const MODES: { key: Mode; label: string; hint: string }[] = [
  { key: 'word', label: '点词', hint: '点击任意单词，查看它在本句中的意思、翻译和搭配' },
  { key: 'sentence', label: '点句', hint: '点击任意句子，查看整句翻译和结构语法分析' },
  {
    key: 'range',
    label: '划线',
    hint: '从一个词按住拖到另一个词（或先点起点、再点终点）划线，查看固定搭配和拓展意思；按 Esc 取消',
  },
];

const cacheKey = (t: Target) =>
  t.kind === 'word' ? `w:${t.word.toLowerCase()}:${t.sid}` : t.kind === 'sentence' ? `s2:${t.sid}` : `r:${t.start}-${t.end}`;

export default function App() {
  const [article, setArticle] = useState<Article | null>(null);
  const [view, setView] = useState<'read' | 'vocab'>('read');
  const [mode, setMode] = useState<Mode>('word');
  const [showZh, setShowZh] = useState(false);
  /** 逐句翻译进度：waiting = 还没有任何译文；refining = 已显示机翻，等待 AI 精翻 */
  const [zhPhase, setZhPhase] = useState<null | 'waiting' | 'refining'>(null);
  const [zhNote, setZhNote] = useState<string | null>(null);
  /** 机翻结果（不持久化），AI 译文到达后被 article.translations 覆盖 */
  const [quickZh, setQuickZh] = useState<Record<string, string>>({});
  const zhReq = useRef(0);
  const [panel, setPanel] = useState<PanelState | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState('');
  const [pending, setPending] = useState<PendingPage[]>([]);
  const [flashSid, setFlashSid] = useState<string | null>(null);
  const [articles, setArticles] = useState<Article[]>(() => store.listArticles());
  const [vocab, setVocab] = useState<VocabItem[]>(() => store.listVocab());
  const [layout, setLayout] = useState<Layout>(() => (localStorage.getItem('er:layout') === 'side' ? 'side' : 'bottom'));
  const header = useRef<HTMLElement>(null);

  useEffect(() => localStorage.setItem('er:layout', layout), [layout]);

  // 顶栏高度（左右布局时面板从顶栏下方开始）+ 恢复上次拖动的面板尺寸
  useLayoutEffect(() => {
    const root = document.documentElement.style;
    for (const v of ['--side-w', '--panel-h']) {
      const saved = localStorage.getItem('er:' + v);
      if (saved) root.setProperty(v, saved);
    }
    const el = header.current;
    if (!el) return;
    const ro = new ResizeObserver(() => root.setProperty('--topbar-h', el.offsetHeight + 'px'));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const doc = useMemo(() => (article ? buildDoc(article.paragraphs) : null), [article?.id]);
  const articleRef = useRef(article);
  articleRef.current = article;
  const reqId = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);

  const refreshLists = () => {
    setArticles(store.listArticles());
    setVocab(store.listVocab());
  };

  function commit(next: Article) {
    store.saveArticle(next);
    setArticle(next);
    setArticles(store.listArticles());
  }

  function openArticle(a: Article | undefined) {
    if (!a) return;
    reqId.current++;
    zhReq.current++;
    setArticle(a);
    setPanel(null);
    setShowZh(false);
    setZhPhase(null);
    setZhNote(null);
    setQuickZh({});
    setView('read');
    setHistoryOpen(false);
    window.scrollTo({ top: 0 });
  }

  /** 加入待识别列表；一次选中的多张按文件名自然排序（IMG_2 在 IMG_10 前面） */
  const addFiles = useCallback((files: File[]) => {
    const sorted = [...files].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    setPending((cur) => [...cur, ...sorted.map((file) => ({ id: uid(), file, url: URL.createObjectURL(file) }))]);
    setUploadError(null);
    setView('read');
    setArticle(null);
    setPanel(null);
  }, []);

  // ---------- 手机扫码拍照 ----------
  const [phoneSession, setPhoneSession] = useState<string | null>(null);
  const [phoneOpen, setPhoneOpen] = useState(false);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [phoneConnected, setPhoneConnected] = useState(false);
  const [phoneCount, setPhoneCount] = useState(0);

  async function openPhone() {
    setPhoneOpen(true);
    setView('read');
    setArticle(null);
    setPanel(null);
    if (phoneSession) return;
    setPhoneError(null);
    try {
      setPhoneSession((await api.mobileSession()).id);
    } catch (e: any) {
      setPhoneError(e.message || String(e));
    }
  }

  function disconnectPhone() {
    setPhoneSession(null);
    setPhoneOpen(false);
    setPhoneConnected(false);
    setPhoneCount(0);
    setPhoneError(null);
  }

  useEffect(() => {
    if (!phoneSession) return;
    const es = new EventSource(`/api/mobile/${phoneSession}/events`);
    let chain = Promise.resolve(); // 保证按到达顺序加入列表
    es.addEventListener('ready', (e) => {
      setPhoneError(null);
      if (JSON.parse((e as MessageEvent).data).phone) setPhoneConnected(true);
    });
    es.addEventListener('phone', () => setPhoneConnected(true));
    es.addEventListener('image', (e) => {
      const { seq, image } = JSON.parse((e as MessageEvent).data) as { seq: number; image: string };
      setPhoneConnected(true);
      chain = chain
        .then(() => fetch(image).then((r) => r.blob()))
        .then((blob) => {
          addFiles([new File([blob], `手机拍照-${String(seq).padStart(3, '0')}.jpg`, { type: blob.type || 'image/jpeg' })]);
          setPhoneCount((n) => n + 1);
        })
        .catch((err) => console.error('[phone] 接收图片失败', err));
    });
    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED) setPhoneError('与手机的连接已断开（后端可能重启过），请点「断开」后重新打开');
    };
    return () => es.close();
  }, [phoneSession, addFiles]);

  function removePending(id: string) {
    const p = pending.find((x) => x.id === id);
    if (p) URL.revokeObjectURL(p.url);
    setPending((cur) => cur.filter((x) => x.id !== id));
  }

  function replacePending(id: string, file: File) {
    const old = pending.find((p) => p.id === id);
    if (old) URL.revokeObjectURL(old.url);
    const url = URL.createObjectURL(file);
    setPending((cur) => cur.map((p) => (p.id === id ? { ...p, file, url } : p)));
  }

  function movePending(from: number, to: number) {
    setPending((cur) => {
      if (to < 0 || to >= cur.length) return cur;
      const next = [...cur];
      const [x] = next.splice(from, 1);
      next.splice(to, 0, x);
      return next;
    });
  }

  function clearPending() {
    pending.forEach((p) => URL.revokeObjectURL(p.url));
    setPending([]);
    setUploadError(null);
  }

  async function recognize() {
    const list = pending;
    if (!list.length || uploading) return;
    setUploading(true);
    setUploadError(null);
    let done = 0;
    const total = list.length;
    setUploadProgress(total > 1 ? `正在识别 0 / ${total} 页……` : '正在识别文章……');
    try {
      let thumb = '';
      const pages: OcrPage[] = await mapLimit(list, 3, async (p, i) => {
        try {
          const img = await prepareImage(p.file);
          if (i === 0) thumb = img.thumb;
          const r = await api.ocr(img.full);
          done++;
          if (total > 1) setUploadProgress(`正在识别 ${done} / ${total} 页……`);
          return r;
        } catch (e: any) {
          throw new Error((total > 1 ? `第 ${i + 1} 页（${p.file.name}）识别失败：` : '') + (e.message || String(e)));
        }
      });
      const empty = pages.map((r, i) => (r.paragraphs.length ? 0 : i + 1)).filter(Boolean);
      const merged = mergePages(pages);
      if (!merged.paragraphs.length) throw new Error('没有在图片中识别到英文文章，请换更清晰的照片');
      const a: Article = {
        id: uid(),
        title: merged.title || merged.paragraphs[0][0].slice(0, 48),
        createdAt: Date.now(),
        thumb,
        pages: total - empty.length,
        paragraphs: merged.paragraphs,
        highlights: [],
      };
      store.saveArticle(a);
      setArticles(store.listArticles());
      list.forEach((p) => URL.revokeObjectURL(p.url));
      setPending([]);
      openArticle(a);
      if (empty.length) setTimeout(() => alert(`第 ${empty.join('、')} 页没有识别到英文，已跳过`), 50);
    } catch (e: any) {
      // 识别失败时保留待识别列表，方便调整后重试
      setUploadError(e.message || String(e));
    } finally {
      setUploading(false);
      setUploadProgress('');
    }
  }

  async function explain(target: Target) {
    const a = articleRef.current;
    if (!a || !doc) return;
    const id = ++reqId.current;
    const key = cacheKey(target);
    const cached = store.getCache(a.id, key);
    if (cached) {
      setPanel({ target, data: cached });
      return;
    }
    setPanel({ target, loading: true });
    // 同时请求词典 / 机翻，先垫上简单结果；失败静默忽略，只等 AI
    const quick: Promise<QuickResult> =
      target.kind === 'word'
        ? api.quickWord(target.word).then((word) => ({ word }))
        : api
            .quickTranslate([{ id: 'q', text: target.kind === 'sentence' ? doc.sentences.get(target.sid)!.text : target.text }])
            .then((r) => ({ zh: r.items.q }));
    quick
      .then((q) => {
        if (id !== reqId.current || (!q.word && !q.zh)) return;
        setPanel((p) => (p && p.target === target && !p.data ? { ...p, quick: q } : p));
      })
      .catch(() => {});
    try {
      let data: any;
      if (target.kind === 'word') {
        data = await api.word(target.word, doc.sentences.get(target.sid)!.text);
      } else if (target.kind === 'sentence') {
        data = await api.sentence(doc.sentences.get(target.sid)!.text, surroundingOf(doc, target.sid));
      } else {
        data = await api.range(target.text, contextOf(doc, target.start, target.end));
      }
      store.setCache(a.id, key, data);
      if (id === reqId.current) setPanel({ target, data });
    } catch (e: any) {
      // 保留已显示的快速结果，下方提示出错并可重试
      if (id === reqId.current) setPanel((p) => ({ target, error: e.message || String(e), quick: p?.target === target ? p.quick : undefined }));
    }
  }

  function onWord(i: number) {
    const t = doc!.tokens[i];
    explain({ kind: 'word', i, word: t.text, sid: t.sid });
  }

  function onRange(start: number, end: number) {
    const a = articleRef.current!;
    let h = a.highlights.find((x) => x.start === start && x.end === end);
    if (!h) {
      h = { id: uid(), start, end, text: textOf(doc!, start, end), createdAt: Date.now() };
      commit({ ...a, highlights: [...a.highlights, h].sort((x, y) => x.start - y.start) });
    }
    explain({ kind: 'range', hid: h.id, start, end, text: h.text });
  }

  function onOpenHighlight(hid: string) {
    const h = articleRef.current?.highlights.find((x) => x.id === hid);
    if (h) explain({ kind: 'range', hid, start: h.start, end: h.end, text: h.text });
  }

  function onDeleteHighlight(hid: string) {
    const a = articleRef.current!;
    commit({ ...a, highlights: a.highlights.filter((h) => h.id !== hid) });
    setPanel(null);
  }

  async function toggleZh() {
    if (showZh) return setShowZh(false);
    const a = articleRef.current;
    if (!a || !doc) return;
    if (a.translations && doc.order.every((s) => a.translations![s.id])) return setShowZh(true);
    if (zhPhase) return setShowZh(true); // 正在翻译：只是重新显示
    const tok = ++zhReq.current;
    const isCur = () => tok === zhReq.current;
    setZhPhase('waiting');
    setZhNote(null);

    // 先用机翻：按组并发，每组返回就显示
    const missing = doc.order.filter((s) => !a.translations?.[s.id]);
    const chunks: (typeof missing)[] = [];
    for (let i = 0; i < missing.length; i += QUICK_BATCH) chunks.push(missing.slice(i, i + QUICK_BATCH));
    let quickGot = 0;
    const quickDone = mapLimit(chunks, 4, async (c) => {
      try {
        const r = await api.quickTranslate(c.map((s) => ({ id: s.id, text: s.text })));
        if (!isCur() || !Object.keys(r.items).length) return;
        quickGot += Object.keys(r.items).length;
        setQuickZh((q) => ({ ...q, ...r.items }));
        setShowZh(true);
        setZhPhase((p) => (p === 'waiting' ? 'refining' : p));
      } catch {
        /* 机翻失败：静默，只等 AI */
      }
    });

    // 同时请求 AI 翻译（整篇一起发，保留上下文）
    try {
      const r = await api.translate(doc.order.map((s) => ({ id: s.id, text: s.text })));
      const cur = articleRef.current;
      if (isCur() && cur?.id === a.id) {
        commit({ ...cur, translations: { ...cur.translations, ...r.items } });
        setShowZh(true);
      }
    } catch (e: any) {
      await quickDone;
      if (!isCur()) return;
      if (quickGot) setZhNote('AI 翻译失败，当前显示的是机器翻译');
      else alert('翻译失败：' + (e.message || e));
    } finally {
      if (isCur()) setZhPhase(null);
    }
  }

  function savedKey(p: PanelState): { kind: VocabKind; text: string } {
    const t = p.target;
    if (t.kind === 'word') return { kind: 'word', text: (p.data?.word as string) || p.quick?.word?.lemma || t.word };
    if (t.kind === 'range') return { kind: 'phrase', text: t.text };
    return { kind: 'sentence', text: doc?.sentences.get(t.sid)?.text || '' };
  }

  function onToggleSave(kind: VocabKind, text: string, meaning: string, extra?: string) {
    const a = articleRef.current;
    if (!a || !doc || !panel) return;
    if (store.hasVocab(kind, text)) {
      store.removeVocab(kind, text);
    } else {
      const t = panel.target;
      const sid = t.kind === 'range' ? doc.tokens[t.start].sid : t.sid;
      const context = t.kind === 'range' ? contextOf(doc, t.start, t.end) : doc.sentences.get(sid)?.text || '';
      store.addVocab({ kind, text, meaning, extra, context, sid, articleId: a.id, articleTitle: a.title });
    }
    setVocab(store.listVocab());
  }

  function jumpToVocab(v: VocabItem) {
    const a = store.getArticle(v.articleId);
    if (!a) return alert('原文章已被删除');
    openArticle(a);
    if (v.sid) {
      setFlashSid(v.sid);
      setTimeout(() => setFlashSid(null), 2200);
    }
  }

  function deleteArticle(id: string) {
    store.deleteArticle(id);
    if (article?.id === id) {
      setArticle(null);
      setPanel(null);
    }
    refreshLists();
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (!article || view !== 'read') return;
      if (e.key === '1') setMode('word');
      if (e.key === '2') setMode('sentence');
      if (e.key === '3') setMode('range');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [article, view]);

  // 点句且讲解已返回时，把成分划分对应到原文
  const structure = useMemo(
    () =>
      doc && panel?.target.kind === 'sentence' && panel.data
        ? buildStructure(doc, panel.target.sid, panel.data.components)
        : EMPTY_STRUCTURE,
    [doc, panel],
  );

  const reading = view === 'read' && article && doc;
  const sk = panel ? savedKey(panel) : null;

  return (
    <div className={`app layout-${layout} ${panel && reading ? 'has-panel' : ''}`}>
      <header className="topbar" ref={header}>
        <div className="brand" onClick={() => { setView('read'); setArticle(null); setPanel(null); }}>
          LensReader
        </div>
        {reading && (
          <div className="seg modes">
            {MODES.map((m, k) => (
              <button key={m.key} className={mode === m.key ? 'on' : ''} onClick={() => setMode(m.key)} title={`快捷键 ${k + 1}`}>
                {m.label}
              </button>
            ))}
          </div>
        )}
        {reading && (
          <button className={showZh ? 'btn on' : 'btn'} onClick={toggleZh} disabled={zhPhase === 'waiting'}>
            {zhPhase === 'waiting' ? '翻译中…' : showZh ? '隐藏译文' : '逐句翻译'}
          </button>
        )}
        {reading && showZh && (zhPhase === 'refining' || zhNote) && (
          <span className={zhNote ? 'zh-status warn' : 'zh-status'}>{zhNote || 'AI 精翻中…'}</span>
        )}
        {reading && (
          <div className="seg layout-toggle" title="讲解面板的位置">
            <button className={layout === 'bottom' ? 'on' : ''} onClick={() => setLayout('bottom')}>
              <span className="ico ico-bottom" />
              上下
            </button>
            <button className={layout === 'side' ? 'on' : ''} onClick={() => setLayout('side')}>
              <span className="ico ico-side" />
              左右
            </button>
          </div>
        )}
        <div className="spacer" />
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            const fs = Array.from(e.target.files || []).filter((f) => f.type.startsWith('image/'));
            e.target.value = '';
            if (fs.length) addFiles(fs);
          }}
        />
        <button className="btn" onClick={() => fileInput.current?.click()} disabled={uploading}>
          ＋ 上传
        </button>
        <button
          className={phoneSession ? 'btn on' : 'btn'}
          onClick={() => (phoneOpen && view === 'read' && !article ? setPhoneOpen(false) : openPhone())}
          disabled={uploading}
          title="手机扫码拍照，照片自动传到这里"
        >
          📱 手机拍照{phoneSession && phoneCount > 0 ? <span className="count">{phoneCount}</span> : null}
        </button>
        <button className="btn" onClick={() => setHistoryOpen(true)}>
          历史
        </button>
        <button className={view === 'vocab' ? 'btn on' : 'btn'} onClick={() => setView(view === 'vocab' ? 'read' : 'vocab')}>
          生词本 <span className="count">{vocab.length}</span>
        </button>
      </header>

      <main className="main">
        {view === 'vocab' ? (
          <VocabBook
            items={vocab}
            onRemove={(id) => {
              store.removeVocabById(id);
              setVocab(store.listVocab());
            }}
            onJump={jumpToVocab}
          />
        ) : reading ? (
          <>
            <p className="hint">{MODES.find((m) => m.key === mode)!.hint}</p>
            <h1 className="a-title">{article.title}</h1>
            <ArticleView
              doc={doc}
              article={article}
              mode={mode}
              showZh={showZh}
              quickZh={quickZh}
              target={panel?.target ?? null}
              flashSid={flashSid}
              structure={structure}
              onWord={onWord}
              onSentence={(sid) => explain({ kind: 'sentence', sid })}
              onRange={onRange}
              onOpenHighlight={onOpenHighlight}
            />
          </>
        ) : (
          <div className="home">
            {phoneOpen && (
              <PhoneLink
                sessionId={phoneSession}
                error={phoneError}
                connected={phoneConnected}
                received={phoneCount}
                onClose={() => setPhoneOpen(false)}
                onDisconnect={disconnectPhone}
              />
            )}
            <Uploader
              onPhone={openPhone}
              onReplace={replacePending}
              busy={uploading}
              progress={uploadProgress}
              error={uploadError}
              pages={pending}
              onAdd={addFiles}
              onRemove={removePending}
              onMove={movePending}
              onClear={clearPending}
              onStart={recognize}
            />
            {articles.length > 0 && (
              <>
                <h3 className="home-sub">最近的文章</h3>
                <HistoryList articles={articles.slice(0, 6)} onOpen={(id) => openArticle(store.getArticle(id))} onDelete={deleteArticle} />
              </>
            )}
          </div>
        )}
      </main>

      {reading && panel && sk && (
        <ExplainPanel
          key={cacheKey(panel.target)}
          panel={panel}
          doc={doc}
          layout={layout}
          structure={structure}
          saved={vocab.some((v) => v.kind === sk.kind && v.text.toLowerCase() === sk.text.toLowerCase())}
          onToggleSave={onToggleSave}
          onDeleteHighlight={onDeleteHighlight}
          onRetry={() => explain(panel.target)}
          onClose={() => {
            reqId.current++;
            setPanel(null);
          }}
        />
      )}

      {historyOpen && (
        <HistoryDrawer
          articles={articles}
          currentId={article?.id}
          onOpen={(id) => openArticle(store.getArticle(id))}
          onDelete={deleteArticle}
          onClose={() => setHistoryOpen(false)}
        />
      )}
    </div>
  );
}
