import 'dotenv/config';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { createLLM } from './llm';
import { mountMobile } from './mobile';
import { ACCESS_DENIED, ACCESS_HEADER, checkAccess, routes } from './routes';

const llm = createLLM({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_BASE_URL,
  textModel: process.env.TEXT_MODEL,
  visionModel: process.env.VISION_MODEL,
});
const accessCode = process.env.ACCESS_CODE || undefined;

const app = express();
app.use(express.json({ limit: '20mb' }));
mountMobile(app, accessCode);

for (const [p, handler] of Object.entries(routes)) {
  app.post('/api' + p, async (req, res) => {
    if (!checkAccess(accessCode, req.get(ACCESS_HEADER))) {
      res.status(401).json(ACCESS_DENIED);
      return;
    }
    try {
      res.json(await handler(req.body || {}, llm));
    } catch (e: any) {
      console.error(`[${p}]`, e?.message || e);
      res.status(500).json({ error: e?.message || String(e) });
    }
  });
}

// 生产模式：托管 vite build 的产物
const dist = path.resolve('dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.use((req, res, next) => {
    if (req.method === 'GET' && !req.path.startsWith('/api')) res.sendFile(path.join(dist, 'index.html'));
    else next();
  });
}

const port = Number(process.env.PORT || 8787);
app.listen(port, () => {
  console.log(
    `[server] http://localhost:${port}  base=${process.env.OPENAI_BASE_URL || 'OpenAI'} vision=${llm.visionModel} text=${llm.textModel}${accessCode ? '  (已启用访问口令)' : ''}`,
  );
});
