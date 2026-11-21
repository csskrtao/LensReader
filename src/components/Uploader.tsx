import { useEffect, useRef, useState } from 'react';
import type { PendingPage } from '../types';
import Cropper from './Cropper';

interface Props {
  busy: boolean;
  progress: string;
  error: string | null;
  pages: PendingPage[];
  onAdd: (files: File[]) => void;
  onRemove: (id: string) => void;
  onMove: (from: number, to: number) => void;
  onClear: () => void;
  onStart: () => void;
  onPhone: () => void;
  onReplace: (id: string, file: File) => void;
}

const imagesOf = (list: FileList | File[] | undefined | null) =>
  Array.from(list || []).filter((f) => f.type.startsWith('image/'));

export default function Uploader({ busy, progress, error, pages, onAdd, onRemove, onMove, onClear, onStart, onPhone, onReplace }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragTo, setDragTo] = useState<number | null>(null);
  const [cropping, setCropping] = useState<PendingPage | null>(null);

  // 支持直接 Ctrl+V 粘贴截图（可多次粘贴，依次追加）
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const fs = imagesOf(e.clipboardData?.files);
      if (fs.length && !busy) onAdd(fs);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [busy, onAdd]);

  const hasPages = pages.length > 0;

  return (
    <div className="uploader-wrap">
      <div
        className={`uploader ${hasPages ? 'compact' : ''} ${over ? 'over' : ''} ${busy ? 'busy' : ''}`}
        onClick={() => !busy && input.current?.click()}
        onDragOver={(e) => {
          if (dragFrom !== null) return;
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          const fs = imagesOf(e.dataTransfer.files);
          if (fs.length && !busy) onAdd(fs);
        }}
      >
        <input
          ref={input}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            const fs = imagesOf(e.target.files);
            e.target.value = '';
            if (fs.length) onAdd(fs);
          }}
        />
        {busy ? (
          <>
            <div className="spinner" />
            <p>{progress || '正在识别文章……'}</p>
            <p className="muted small">每页通常需要 10~30 秒，多页会同时识别</p>
          </>
        ) : hasPages ? (
          <p className="up-more">＋ 继续添加照片（点击 · 拖拽 · Ctrl+V）</p>
        ) : (
          <>
            <div className="up-icon">📷</div>
            <p className="up-title">上传英语文章的照片</p>
            <p className="muted">可一次选多张 —— 文章跨了好几页也没关系，会按顺序合成一篇</p>
            <p className="muted small">点击选择 · 拖拽到这里 · 或直接 Ctrl+V 粘贴截图</p>
            <button
              className="btn up-phone"
              onClick={(e) => {
                e.stopPropagation();
                onPhone();
              }}
            >
              📱 用手机扫码拍照
            </button>
          </>
        )}
        {error && <p className="error-text">{error}</p>}
      </div>

      {hasPages && (
        <div className="pending">
          <div className="pending-head">
            <span>
              共 {pages.length} 张，<b>请按页码顺序排列</b>
              <span className="muted">（拖动或用 ‹ › 调整）；跨页断开的句子和段落会自动接上</span>
            </span>
          </div>
          <ol className="pending-grid">
            {pages.map((p, i) => (
              <li
                key={p.id}
                className={`${dragFrom === i ? 'dragging' : ''} ${dragTo === i && dragFrom !== i ? 'drop-to' : ''}`}
                draggable={!busy}
                onDragStart={(e) => {
                  setDragFrom(i);
                  e.dataTransfer.effectAllowed = 'move';
                  e.dataTransfer.setData('text/plain', String(i));
                }}
                onDragOver={(e) => {
                  if (dragFrom === null) return;
                  e.preventDefault();
                  setDragTo(i);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragFrom !== null && dragFrom !== i) onMove(dragFrom, i);
                  setDragFrom(null);
                  setDragTo(null);
                }}
                onDragEnd={() => {
                  setDragFrom(null);
                  setDragTo(null);
                }}
              >
                <img src={p.url} alt={`第 ${i + 1} 页`} draggable={false} />
                <span className="page-no">{i + 1}</span>
                {!busy && (
                  <button className="page-crop" title="裁剪：只保留文章区域" onClick={() => setCropping(p)}>
                    ✂
                  </button>
                )}
                {!busy && (
                  <button className="page-del" title="移除" onClick={() => onRemove(p.id)}>
                    ✕
                  </button>
                )}
                <div className="page-ops">
                  <button className="btn small ghost" disabled={busy || i === 0} onClick={() => onMove(i, i - 1)} title="前移">
                    ‹
                  </button>
                  <span className="page-name" title={p.file.name}>
                    {p.file.name}
                  </span>
                  <button
                    className="btn small ghost"
                    disabled={busy || i === pages.length - 1}
                    onClick={() => onMove(i, i + 1)}
                    title="后移"
                  >
                    ›
                  </button>
                </div>
              </li>
            ))}
          </ol>
          <div className="pending-actions">
            <button className="btn ghost" onClick={onClear} disabled={busy}>
              清空
            </button>
            <button className="btn primary" onClick={onStart} disabled={busy}>
              {busy ? '识别中…' : pages.length > 1 ? `识别并合成一篇（${pages.length} 页）` : '开始识别'}
            </button>
          </div>
        </div>
      )}

      {cropping && (
        <Cropper
          file={cropping.file}
          label={`裁剪 第 ${pages.findIndex((p) => p.id === cropping.id) + 1} 页`}
          onCancel={() => setCropping(null)}
          onDone={(f) => {
            if (f !== cropping.file) onReplace(cropping.id, f);
            setCropping(null);
          }}
        />
      )}
    </div>
  );
}
