export interface Entry {
  id: string;
  cat: string;
  title: string;
  py: string;
  tags: string[];
  summary: string;
  body: string;
  createdAt: number;
  updatedAt: number;
}

// 数据库中的原始行（tags 以 JSON 字符串存储）
export interface EntryRow {
  id: string;
  cat: string;
  title: string;
  py: string;
  tags: string;
  summary: string;
  body: string;
  createdAt: number;
  updatedAt: number;
}
