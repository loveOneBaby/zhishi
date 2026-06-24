// 结构化多级索引节点
export interface IndexNode {
  id: string;
  title: string;
  content: string;
  children: IndexNode[];
}

// 知识库：顶层实体，容纳若干文件夹与知识点
export interface KnowledgeBase {
  id: string;
  name: string;
  sort: number;
  createdAt?: number;
  updatedAt?: number;
}

// 文件夹：归属于某个知识库，可多级嵌套（parentId 为 null 表示挂在知识库根）
export interface Folder {
  id: string;
  kbId: string;
  parentId: string | null;
  name: string;
  sort: number;
  createdAt?: number;
  updatedAt?: number;
}

export interface Entry {
  id: string;
  cat: string;            // 所属知识库名（派生，用于检索 / 展示）
  kbId: string;           // 所属知识库 id
  folderId: string | null; // 所属文件夹 id（null = 知识库根级）
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
  kbId?: string;
  folderId?: string | null;
  cat?: string;          // 兼容旧调用：无 kbId 时按此名查找/创建知识库
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
