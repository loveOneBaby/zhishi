import type { IndexNode } from './index-tree.js';
export type { IndexNode, IndexTree } from './index-tree.js';

export interface Entry {
  id: string;
  cat: string;
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
