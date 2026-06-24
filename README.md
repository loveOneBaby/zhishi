# 面试知识快速检索网站

把原型 demo 产品化后的版本。前端 React + Vite + TypeScript 忠实还原 demo 的交互；后端 TypeScript + Express + SQLite 提供数据存储与检索 API，并预留 AI 问答接口。

## 功能

- **检索模式**：关键词 / 拼音 / 缩写即时检索（如 `bibao`、`scws`、`gc`），支持「列表」与「画布」（Cytoscape 关系图）两种视图。
- **自由模式**：按分类浏览全部知识点卡片。
- **详情思维导图**：点开任一知识点，左侧主卡 + 右侧按小标题拆分的知识点节点。
- **新建知识点**：表单录入，保存到 SQLite 永久持久化。
- **三种主题**：极简 / 终端 / 纸感，选择会记忆。
- **AI 问答（预留）**：检索未命中时按回车调用 `/api/ask`，配置 API Key 即可启用。

## 目录结构

```
.
├─ server/        # 后端：Express + better-sqlite3 + TS
│  └─ src/
│     ├─ index.ts       入口
│     ├─ app.ts         路由 / 静态托管
│     ├─ db.ts          SQLite 初始化、CRUD、首次导入种子
│     ├─ search.ts      检索打分
│     ├─ ask.ts         AI 问答（预留接口）
│     └─ seed-data.ts   内置知识库
├─ web/           # 前端：React + Vite + TS
│  └─ src/
│     ├─ App.tsx        总装与交互
│     ├─ components/    各界面组件
│     ├─ search.ts      客户端检索（与服务端一致）
│     └─ markdown.tsx   轻量 markdown 渲染
└─ package.json   # 根目录便捷脚本
```

## 快速开始

需要 Node.js 18+。

### 1. 安装依赖

```bash
npm run install:all
```

### 2. 开发模式（前后端分别热更新）

开两个终端：

```bash
npm run dev:server   # 后端 http://localhost:5173
npm run dev:web      # 前端 http://localhost:3000（/api 自动代理到后端）
```

浏览器打开 http://localhost:3000 。

### 3. 生产构建与运行

```bash
npm run build        # 构建前端 + 编译后端
npm start            # 启动后端，同时托管前端，访问 http://localhost:5173
```

## 数据存储

- 使用 SQLite，数据库文件默认在 `server/data/knowledge.db`，首次启动自动导入内置知识点。
- 新建的知识点会写入数据库，永久保留。
- 可通过环境变量 `DB_PATH` 自定义数据库位置。

## AI 问答接入（可选）

复制 `server/.env.example` 为 `server/.env` 并填入：

```
AI_API_KEY=sk-xxxx
AI_BASE_URL=https://api.openai.com/v1   # 可换成任意 OpenAI 兼容服务
AI_MODEL=gpt-4o-mini
```

未配置时，AI 弹窗会提示「未配置」，其余功能不受影响。

## API 一览

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/entries` | 全部知识点 |
| GET | `/api/search?q=` | 检索 |
| GET | `/api/entries/:id` | 单条 |
| POST | `/api/entries` | 新建 |
| PUT | `/api/entries/:id` | 更新 |
| DELETE | `/api/entries/:id` | 删除 |
| POST | `/api/ask` | AI 问答（预留） |
