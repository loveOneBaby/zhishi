export interface SeedEntry {
  id: string;
  cat: string;
  title: string;
  py: string; // 拼音 / 缩写，用于检索
  tags: string[];
  summary: string;
  body: string; // 轻量 markdown（## 小标题 / - 列表 / **加粗** / `代码` / ```代码块```）
}
