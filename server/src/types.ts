import type { IndexNode } from './index-tree.js';
export type { IndexNode, IndexTree } from './index-tree.js';

// 知识库：顶层实体，容纳若干文件夹与知识点
export interface KnowledgeBase {
  id: string;
  name: string;
  sort: number;
  createdAt: number;
  updatedAt: number;
}

// 文件夹：归属于某个知识库，可多级嵌套（parentId 为 null 表示挂在知识库根）
export interface Folder {
  id: string;
  kbId: string;
  parentId: string | null;
  name: string;
  sort: number;
  createdAt: number;
  updatedAt: number;
}

export interface Entry {
  id: string;
  cat: string;            // 所属知识库名（派生自 kbId，用于检索 / 展示）
  kbId: string;           // 所属知识库 id
  folderId: string | null; // 所属文件夹 id（null = 知识库根级）
  title: string;
  py: string;
  tags: string[];
  summary: string;
  intro: string;        // 索引前的引言
  nodes: IndexNode[];   // 结构化多级索引
  sort: number;
  createdAt: number;
  updatedAt: number;
}

// 数据库中的原始行（tags 与 index 以 JSON 字符串存储；body 为旧字段，仅用于迁移）
export interface EntryRow {
  id: string;
  cat: string;
  kbId?: string;
  folderId?: string | null;
  title: string;
  py: string;
  tags: string;
  summary: string;
  body?: string;
  idx?: string;
  sort: number;
  createdAt: number;
  updatedAt: number;
}

export interface KbRow {
  id: string;
  name: string;
  sort: number;
  createdAt: number;
  updatedAt: number;
}

export interface FolderRow {
  id: string;
  kbId: string;
  parentId: string | null;
  name: string;
  sort: number;
  createdAt: number;
  updatedAt: number;
}
