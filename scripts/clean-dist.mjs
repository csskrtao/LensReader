// 构建前清空 dist/。
// 不用 fs.rmSync / vite 自带的 emptyOutDir：Node 24 在 Windows 上对本项目路径调用 rmSync 会原生崩溃（0xC0000409），
// 所以逐个 unlink / rmdir。
import fs from 'node:fs';
import path from 'node:path';

function remove(p) {
  let st;
  try {
    st = fs.lstatSync(p);
  } catch {
    return;
  }
  if (st.isDirectory()) {
    for (const name of fs.readdirSync(p)) remove(path.join(p, name));
    fs.rmdirSync(p);
  } else {
    fs.unlinkSync(p);
  }
}

remove(path.resolve('dist'));
