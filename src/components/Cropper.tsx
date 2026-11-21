import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

/** 裁剪框，坐标为相对图片的 0~1 */
interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
type Handle = 'move' | 'n' | 's' | 'e' | 'w' | 'nw' | 'ne' | 'sw' | 'se';

interface Props {
  file: File;
  /** 例如「第 2 / 3 张」 */
  label?: string;
  onDone: (file: File) => void;
  /** 不裁剪，直接用原图 */
  onOriginal?: () => void;
  onCancel: () => void;
  cancelText?: string;
}

const FULL: Box = { x: 0, y: 0, w: 1, h: 1 };
const MIN = 0.06;
const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('无法读取这张图片（如果是 HEIC 格式，请先转换为 JPG/PNG）'));
    img.src = src;
  });
}

function toBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('图片导出失败'))), 'image/jpeg', 0.92),
  );
}

/** 拖动裁剪框截取图片中文章所在的区域，可旋转 */
export default function Cropper({ file, label, onDone, onOriginal, onCancel, cancelText = '取消' }: Props) {
  const [src, setSrc] = useState('');
  const [rotation, setRotation] = useState(0); // 0 / 90 / 180 / 270
  const [box, setBox] = useState<Box>(FULL);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const wrap = useRef<HTMLDivElement>(null);
  const drag = useRef<{ handle: Handle; x: number; y: number; box: Box } | null>(null);

  // 按当前旋转角度生成显示用的图片
  useEffect(() => {
    let url = '';
    let alive = true;
    const base = URL.createObjectURL(file);
    (async () => {
      try {
        if (rotation === 0) {
          url = base;
        } else {
          const img = await loadImage(base);
          const swap = rotation % 180 !== 0;
          const c = document.createElement('canvas');
          c.width = swap ? img.naturalHeight : img.naturalWidth;
          c.height = swap ? img.naturalWidth : img.naturalHeight;
          const ctx = c.getContext('2d')!;
          ctx.translate(c.width / 2, c.height / 2);
          ctx.rotate((rotation * Math.PI) / 180);
          ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
          URL.revokeObjectURL(base);
          url = URL.createObjectURL(await toBlob(c));
        }
        if (alive) setSrc(url);
        else URL.revokeObjectURL(url);
      } catch (e: any) {
        if (alive) setError(e.message || String(e));
      }
    })();
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
      else URL.revokeObjectURL(base);
    };
  }, [file, rotation]);

  // 拖动裁剪框（鼠标 / 触摸通用）
  useEffect(() => {
    const move = (e: PointerEvent) => {
      const d = drag.current;
      const el = wrap.current;
      if (!d || !el) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const dx = (e.clientX - d.x) / r.width;
      const dy = (e.clientY - d.y) / r.height;
      const b = d.box;
      if (d.handle === 'move') {
        setBox({ ...b, x: clamp(b.x + dx, 0, 1 - b.w), y: clamp(b.y + dy, 0, 1 - b.h) });
        return;
      }
      let left = b.x;
      let top = b.y;
      let right = b.x + b.w;
      let bottom = b.y + b.h;
      if (d.handle.includes('w')) left = clamp(b.x + dx, 0, right - MIN);
      if (d.handle.includes('e')) right = clamp(b.x + b.w + dx, left + MIN, 1);
      if (d.handle.includes('n')) top = clamp(b.y + dy, 0, bottom - MIN);
      if (d.handle.includes('s')) bottom = clamp(b.y + b.h + dy, top + MIN, 1);
      setBox({ x: left, y: top, w: right - left, h: bottom - top });
    };
    const up = () => (drag.current = null);
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, []);

  const start = (handle: Handle) => (e: ReactPointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    drag.current = { handle, x: e.clientX, y: e.clientY, box };
  };

  async function confirm() {
    if (!src || busy) return;
    setBusy(true);
    try {
      const img = await loadImage(src);
      const sx = Math.round(box.x * img.naturalWidth);
      const sy = Math.round(box.y * img.naturalHeight);
      const sw = Math.max(1, Math.round(box.w * img.naturalWidth));
      const sh = Math.max(1, Math.round(box.h * img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = sw;
      c.height = sh;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, sw, sh);
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
      const blob = await toBlob(c);
      const name = file.name.replace(/\.[^.]+$/, '') + '.jpg';
      onDone(new File([blob], name, { type: 'image/jpeg' }));
    } catch (e: any) {
      setError(e.message || String(e));
      setBusy(false);
    }
  }

  const untouched = rotation === 0 && box.x === 0 && box.y === 0 && box.w === 1 && box.h === 1;

  return (
    <div className="cropper">
      <div className="cr-top">
        <span>{label || '裁剪图片'}</span>
        <span className="cr-tip">拖动方框，只框住文章正文</span>
      </div>

      <div className="cr-stage">
        {error ? (
          <p className="cr-error">{error}</p>
        ) : !src ? (
          <div className="spinner" />
        ) : (
          <div className="cr-wrap" ref={wrap}>
            <img src={src} alt="" draggable={false} onLoad={() => setBox(FULL)} />
            <div
              className="cr-box"
              style={{ left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.w * 100}%`, height: `${box.h * 100}%` }}
              onPointerDown={start('move')}
            >
              <i className="cr-grid" />
              {HANDLES.map((h) => (
                <span key={h} className={`cr-h cr-${h}`} onPointerDown={start(h)} />
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="cr-bar">
        <button className="btn" onClick={onCancel} disabled={busy}>
          {cancelText}
        </button>
        <button className="btn" onClick={() => setRotation((r) => (r + 90) % 360)} disabled={busy || !src} title="顺时针旋转 90°">
          ⟳ 旋转
        </button>
        <button className="btn" onClick={() => setBox(FULL)} disabled={busy || !src}>
          全图
        </button>
        <div className="cr-main">
          {onOriginal && (
            <button className="btn" onClick={onOriginal} disabled={busy}>
              使用原图
            </button>
          )}
          <button className="btn primary" onClick={untouched ? (onOriginal ?? (() => onDone(file))) : confirm} disabled={busy || !src}>
            {busy ? '处理中…' : '完成'}
          </button>
        </div>
      </div>
    </div>
  );
}
