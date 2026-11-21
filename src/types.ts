export type Mode = 'word' | 'sentence' | 'range';
export type Layout = 'bottom' | 'side';

export interface Highlight {
  id: string;
  start: number; // 全局 token 下标（含）
  end: number; // 全局 token 下标（含）
  text: string;
  createdAt: number;
}

export interface Article {
  id: string;
  title: string;
  createdAt: number;
  thumb?: string;
  pages?: number; // 由几张照片合成
  paragraphs: string[][];
  translations?: Record<string, string>; // key: 句子 id
  highlights: Highlight[];
}

export interface Token {
  i: number;
  text: string;
  ws: string; // token 之后的空白
  isWord: boolean;
  sid: string;
}

export interface Sentence {
  id: string; // `${段落}-${句}`
  text: string;
  start: number;
  end: number;
}

export interface Doc {
  paragraphs: Sentence[][];
  order: Sentence[];
  tokens: Token[];
  sentences: Map<string, Sentence>;
}

export type Target =
  | { kind: 'word'; i: number; word: string; sid: string }
  | { kind: 'sentence'; sid: string }
  | { kind: 'range'; hid: string; start: number; end: number; text: string };

/** 词典查词的快速结果（有道词典，查不到时谷歌翻译兜底） */
export interface QuickWord {
  word: string;
  lemma?: string;
  phonetic?: string;
  ukphonetic?: string;
  meanings: { pos: string; tran: string }[];
  exam: string[];
}

/** AI 讲解返回前先显示的快速结果：单词用 word，句子 / 划线用 zh（机翻） */
export interface QuickResult {
  word?: QuickWord;
  zh?: string;
}

export interface PanelState {
  target: Target;
  loading?: boolean;
  error?: string;
  data?: any;
  quick?: QuickResult;
}

export type VocabKind = 'word' | 'phrase' | 'sentence';

export interface VocabItem {
  id: string;
  kind: VocabKind;
  text: string;
  meaning: string;
  extra?: string; // 音标/词性等
  context: string;
  sid?: string;
  articleId: string;
  articleTitle: string;
  createdAt: number;
}

export interface WordExp {
  word: string;
  phonetic?: string;
  pos?: string;
  translation?: string;
  meaning_in_context?: string;
  other_meanings?: { pos?: string; meaning: string }[];
  collocations?: { phrase: string; meaning: string }[];
  examples?: { en: string; zh: string }[];
  note?: string;
}

/** 句子成分；带 parts 的是从句，parts 为从句内部的划分 */
export interface Comp {
  text: string;
  role: string;
  zh?: string;
  detail?: string;
  parts?: Comp[];
}

export interface SentenceExp {
  translation?: string;
  structure?: string;
  components?: Comp[];
  grammar?: { point: string; explanation: string }[];
  phrases?: { phrase: string; meaning: string }[];
}

export interface RangeExp {
  type?: string;
  translation?: string;
  meaning_in_context?: string;
  pattern?: string;
  usage?: string;
  extended_meanings?: { meaning: string; example?: string; example_zh?: string }[];
  similar?: { phrase: string; meaning: string }[];
  examples?: { en: string; zh: string }[];
  note?: string;
}

/** 单张照片的识别结果 */
export interface OcrPage {
  title: string;
  paragraphs: string[][];
  startsMidSentence?: boolean;
  startsMidParagraph?: boolean;
  endsMidSentence?: boolean;
  endsMidParagraph?: boolean;
}

/** 待识别的照片 */
export interface PendingPage {
  id: string;
  file: File;
  url: string; // 预览用 object URL
}
