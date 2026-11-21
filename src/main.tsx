import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import MobileCapture from './components/MobileCapture';
import './styles.css';

// 手机扫码打开的链接带 ?m=<会话id>，进入拍照上传页
const mobileSession = new URLSearchParams(location.search).get('m');

createRoot(document.getElementById('root')!).render(
  <StrictMode>{mobileSession ? <MobileCapture sessionId={mobileSession} /> : <App />}</StrictMode>,
);
