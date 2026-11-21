import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { prepareImage } from '../lib/image';
import { uid } from '../lib/tokenize';

type Status = 'queued' | 'uploading' | 'done' | 'error';
interface Shot {
  id: string;
  file: File;
  url: string;
  status: Status;
  error?: string;
}

const imagesOf = (list: FileList | null) => Array.from(list || []).filter((f) => f.type.startsWith('image/') || !f.type);

/** 手机端：扫码后打开的拍照上传页 */
export default function MobileCapture({ sessionId }: { sessionId: string }) {
  const [state, setState] = useState<'connecting' | 'ok' | 'invalid'>('connecting');
  const [msg, setMsg] = useState('');
  const [shots, setShots] = useState<Shot[]>([]);
  const camera = useRef<HTMLInputElement>(null);
  const album = useRef<HTMLInputElement>(null);
  const running = useRef(false);
  const shotsRef = useRef<Shot[]>([]); // 上传循环读写的唯一数据源，同步到 state 用于渲染

  useEffect(() => {
    document.title = '手机拍照上传 · 拍照精读';
    api
      .mobileHello(sessionId)
      .then(() => setState('ok'))
      .catch((e) => {
        setState('invalid');
        setMsg(e.message || String(e));
      });
  }, [sessionId]);

  const update = (fn: (cur: Shot[]) => Shot[]) => {
    shotsRef.current = fn(shotsRef.current);
    setShots(shotsRef.current);
  };
  const patch = (id: string, p: Partial<Shot>) => update((cur) => cur.map((s) => (s.id === id ? { ...s, ...p } : s)));

  /** 按拍摄顺序逐张上传，保证电脑端收到的顺序一致 */
  async function pump() {
    if (running.current) return;
    running.current = true;
    try {
      for (;;) {
        const next = shotsRef.current.find((s) => s.status === 'queued');
        if (!next) break;
        patch(next.id, { status: 'uploading', error: undefined });
        try {
          const { full } = await prepareImage(next.file);
          await api.mobileUpload(sessionId, full);
          patch(next.id, { status: 'done' });
        } catch (e: any) {
          const m = e.message || String(e);
          patch(next.id, { status: 'error', error: m });
          if (/失效/.test(m)) {
            setState('invalid');
            setMsg(m);
            break;
          }
        }
      }
    } finally {
      running.current = false;
    }
  }

  function add(files: File[]) {
    if (!files.length) return;
    update((cur) => [...cur, ...files.map((file) => ({ id: uid(), file, url: URL.createObjectURL(file), status: 'queued' as Status }))]);
    pump();
  }

  function retry(id: string) {
    patch(id, { status: 'queued' });
    pump();
  }

  const done = shots.filter((s) => s.status === 'done').length;
  const busy = shots.some((s) => s.status === 'queued' || s.status === 'uploading');

  if (state === 'invalid') {
    return (
      <div className="m-page">
        <div className="m-card m-center">
          <div className="m-big">⚠️</div>
          <p className="m-title">{msg || '二维码已失效'}</p>
          <p className="muted">请在电脑上重新打开「📱 手机拍照」并扫描新的二维码</p>
        </div>
      </div>
    );
  }

  return (
    <div className="m-page">
      <header className="m-head">
        <b>拍照精读 · 手机上传</b>
        <span className={`m-dot ${state === 'ok' ? 'on' : ''}`}>{state === 'ok' ? '已连接电脑' : '连接中…'}</span>
      </header>

      <input
        ref={camera}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => {
          const fs = imagesOf(e.target.files);
          e.target.value = '';
          add(fs);
        }}
      />
      <input
        ref={album}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          const fs = imagesOf(e.target.files);
          e.target.value = '';
          add(fs);
        }}
      />

      <button className="m-shoot" disabled={state !== 'ok'} onClick={() => camera.current?.click()}>
        <span className="m-big">📷</span>
        {shots.length ? '再拍一张' : '拍照'}
      </button>
      <button className="btn m-album" disabled={state !== 'ok'} onClick={() => album.current?.click()}>
        从相册选择（可多选）
      </button>

      <p className="m-status">
        {shots.length === 0
          ? '按页码顺序逐页拍摄，每拍一张会自动发送到电脑'
          : busy
            ? `正在发送…（已发送 ${done} / ${shots.length} 张）`
            : `已发送 ${done} 张，可以继续拍；拍完回到电脑点「识别」`}
      </p>

      {shots.length > 0 && (
        <ol className="m-grid">
          {shots.map((s, i) => (
            <li key={s.id} className={`m-${s.status}`}>
              <img src={s.url} alt={`第 ${i + 1} 张`} />
              <span className="page-no">{i + 1}</span>
              <span className="m-badge">
                {s.status === 'done' ? '✓' : s.status === 'error' ? '✗' : s.status === 'uploading' ? '…' : '等待'}
              </span>
              {s.status === 'error' && (
                <button className="m-retry" onClick={() => retry(s.id)} title={s.error}>
                  发送失败，点击重试
                </button>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
