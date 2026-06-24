// 结构化多级索引节点
export interface IndexNode {
  id: string;
  title: string;
  content: string;
  children: IndexNode[];
}

export interface Entry {
  id: string;
  cat: string;
  title: string;
  py: string;
  tags: string[];
  summary: string;
  intro: string;        // 索引前的引言
  nodes: IndexNode[];   // 结构化多级索引
  sort?: number;
  createdAt?: number;
  updatedAt?: number;
}

// 知识点录入 / 编辑的输入。summary、py 可留空，服务端会自动推导。
export interface EntryInput {
  title: string;
  cat: string;
  tags: string[];
  summary?: string;
  py?: string;
  intro?: string;
  nodes?: IndexNode[];
}

export type ThemeKey = 'mono' | 'ink' | 'paper';

export interface Theme {
  name: string;
  bg: string;
  fg: string;
  mut: string;
  bd: string;
  panel: string;
  sel: string;
  accent: string;
  danger: string;
  font: string;
}
