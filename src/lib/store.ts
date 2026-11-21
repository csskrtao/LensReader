import type { Article, VocabItem, VocabKind } from '../types';
import { uid } from './tokenize';

const K = {
  articles: 'er:articles',
  vocab: 'er:vocab',
  cache: (id: string) => `er:cache:${id}`,
};

function read<T>(key: string, def: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : def;
  } catch {
    return def;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    alert('浏览器本地存储空间不足，请在「历史记录」中删除一些旧文章。');
  }
}

const norm = (s: string) => s.trim().toLowerCase();

export const store = {
  listArticles(): Article[] {
    return read<Article[]>(K.articles, []).sort((a, b) => b.createdAt - a.createdAt);
  },
  getArticle(id: string): Article | undefined {
    return this.listArticles().find((a) => a.id === id);
  },
  saveArticle(a: Article) {
    const list = this.listArticles().filter((x) => x.id !== a.id);
    list.unshift(a);
    write(K.articles, list);
  },
  deleteArticle(id: string) {
    write(
      K.articles,
      this.listArticles().filter((a) => a.id !== id),
    );
    localStorage.removeItem(K.cache(id));
  },

  getCache(articleId: string, key: string): any {
    return read<Record<string, any>>(K.cache(articleId), {})[key];
  },
  setCache(articleId: string, key: string, value: any) {
    const c = read<Record<string, any>>(K.cache(articleId), {});
    c[key] = value;
    write(K.cache(articleId), c);
  },

  listVocab(): VocabItem[] {
    return read<VocabItem[]>(K.vocab, []).sort((a, b) => b.createdAt - a.createdAt);
  },
  hasVocab(kind: VocabKind, text: string): boolean {
    return this.listVocab().some((v) => v.kind === kind && norm(v.text) === norm(text));
  },
  addVocab(item: Omit<VocabItem, 'id' | 'createdAt'>) {
    if (this.hasVocab(item.kind, item.text)) return;
    write(K.vocab, [{ ...item, id: uid(), createdAt: Date.now() }, ...this.listVocab()]);
  },
  removeVocab(kind: VocabKind, text: string) {
    write(
      K.vocab,
      this.listVocab().filter((v) => !(v.kind === kind && norm(v.text) === norm(text))),
    );
  },
  removeVocabById(id: string) {
    write(
      K.vocab,
      this.listVocab().filter((v) => v.id !== id),
    );
  },
};
