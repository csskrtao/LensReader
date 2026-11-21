function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('无法读取这张图片（如果是 HEIC 格式，请先转换为 JPG/PNG）'));
    };
    img.src = url;
  });
}

function draw(img: HTMLImageElement, maxSide: number, quality: number): string {
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.round(img.naturalWidth * scale);
  const h = Math.round(img.naturalHeight * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL('image/jpeg', quality);
}

/** 压缩成适合上传的大图 + 存历史用的小缩略图 */
export async function prepareImage(file: File): Promise<{ full: string; thumb: string }> {
  if (!file.type.startsWith('image/')) throw new Error('请选择图片文件');
  const img = await loadImage(file);
  return { full: draw(img, 2000, 0.85), thumb: draw(img, 160, 0.6) };
}
