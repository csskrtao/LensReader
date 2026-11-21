import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { api } from '../api';

interface Props {
  sessionId: string | null;
  error: string | null;
  connected: boolean;
  received: number;
  onClose: () => void;
  onDisconnect: () => void;
}

const LOCAL = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/** 电脑端：显示二维码，手机扫码后拍照上传 */
export default function PhoneLink({ sessionId, error, connected, received, onClose, onDisconnect }: Props) {
  const [hosts, setHosts] = useState<string[]>([]);
  const [host, setHost] = useState('');
  const [qr, setQr] = useState('');

  useEffect(() => {
    // 用户本身就是通过局域网 IP 打开的页面，直接沿用
    if (!LOCAL.has(location.hostname)) {
      setHosts([location.hostname]);
      setHost(location.hostname);
      return;
    }
    api.lan().then(({ ips }) => {
      setHosts(ips);
      setHost(ips[0] || '');
    });
  }, []);

  const url = sessionId && host ? `${location.protocol}//${host}${location.port ? ':' + location.port : ''}/?m=${sessionId}` : '';

  useEffect(() => {
    if (!url) return setQr('');
    QRCode.toDataURL(url, { width: 220, margin: 1 }).then(setQr, () => setQr(''));
  }, [url]);

  const noLan = LOCAL.has(location.hostname) && hosts.length === 0;

  return (
    <div className="phone-link">
      <div className="pl-qr">
        {qr ? <img src={qr} alt="手机扫码" /> : <div className="pl-qr-empty">{error || noLan ? '无法生成' : <div className="spinner" />}</div>}
      </div>
      <div className="pl-body">
        <div className="pl-head">
          <b>📱 手机扫码拍照上传</b>
          <button className="btn small ghost" onClick={onClose} title="收起（不影响接收）">
            收起
          </button>
        </div>
        <p className="muted small">用手机相机或微信扫一扫，打开后可连续拍多张，每张会自动出现在下方的待识别列表里。</p>

        {error ? (
          <p className="error-text">{error}</p>
        ) : noLan ? (
          <p className="error-text">没有检测到局域网 IP，请确认电脑已连接 WiFi / 网线</p>
        ) : (
          <p className={`pl-state ${connected ? 'on' : ''}`}>
            {connected ? `✓ 手机已连接 · 已收到 ${received} 张` : '等待手机扫码…'}
          </p>
        )}

        {url && (
          <div className="pl-url">
            {hosts.length > 1 && (
              <select value={host} onChange={(e) => setHost(e.target.value)} title="扫不开时换一个网卡地址试试">
                {hosts.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </select>
            )}
            <code>{url}</code>
          </div>
        )}

        <p className="muted small">
          手机和电脑需连接同一个 WiFi。扫码后打不开？试试切换上面的 IP，或在 Windows 防火墙中允许 Node.js 访问专用网络。
        </p>
        <div className="pl-actions">
          <button className="btn small danger" onClick={onDisconnect}>
            断开
          </button>
        </div>
      </div>
    </div>
  );
}
