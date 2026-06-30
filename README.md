# 面试知识快速检索网站

把原型 demo 产品化后的版本。前端 React + Vite + TypeScript 忠实还原 demo 的交互；后端 TypeScript + Express + SQLite 提供数据存储与检索 API，并预留 AI 问答接口。

## 功能

- **检索模式**：关键词 / 拼音 / 缩写即时检索（如 `bibao`、`scws`、`gc`），支持「列表」与「画布」两种视图。
- **画布（知识库视图）**：每个分类（如 `前端`、`Java`）就是一个独立**知识库**，没有上层大根。选中某个知识库后**默认即展开**其下的知识点与小节（节点上直接显示摘要 / 片段，无需点击就能看到知识）；可在知识库内做**内容搜索**；点击知识点 / 小节查看完整详情。
- **沉浸模式与快捷键**：画布右上角「⤢ 沉浸」进入全屏。沉浸下支持快捷键——**左 ⌘ 呼出搜索**、**右 ⌘ 切换知识库**、**Esc 退出**。
- **导入 / 导出**：管理页可一键导出整个知识库为 JSON 备份，或导入 JSON（支持「合并」与「覆盖替换」两种方式）。导入兼容两种格式：旧的扁平 `kb-export-1`（`intro` 为字符串、节点 `content` 为字符串），以及新的富块结构 `kb-import-2`（`intro` 为 `{ blocks }`、节点用 `blocks` 描述段落 / 图片 / 代码 / 引用 / 折叠 / 列表，可带 `assets` 资源表）—— 块结构在导入时自动折叠为可渲染的 markdown 文本。
- **自由模式**：按分类浏览全部知识点卡片。
- **详情思维导图**：点开任一知识点，左侧主卡 + 右侧按小标题拆分的知识点节点。
- **结构化多级索引**：知识点的索引是**一等结构化数据**（`{ intro, nodes }`，每个节点含标题/内容/子节点），不再靠解析 markdown `##` 推导。知识点为一级索引，下设二/三/四级。
- **管理模式**：独立的「管理」标签页，按**知识库分组**展示知识点，可展开任一行对其**多级索引**做结构化编辑——逐级改标题/内容、同级上下排序、增删、加下级，保存即写回；并支持**知识点组内拖拽排序**（持久化到 SQLite）、搜索定位、按知识库筛选、**新建 / 编辑 / 删除**。所有改动即时同步到检索与画布。
- **新建知识点**：表单录入，保存到 SQLite 永久持久化。
- **三种主题**：极简 / 终端 / 纸感，选择会记忆。
- **AI 问答（预留）**：检索未命中时按回车调用 `/api/ask`，配置 API Key 即可启用。

## 目录结构

```
.
├─ server/        # 后端：Express + node:sqlite（Node 内置）+ TS
│  └─ src/
│     ├─ index.ts       入口
│     ├─ app.ts         路由 / 静态托管
│     ├─ db.ts          SQLite 初始化、CRUD、种子版本迁移
│     ├─ search.ts      检索打分
│     ├─ ask.ts         AI 问答（预留接口）
│     └─ seed-data/     按分类拆分的内置知识库
├─ web/           # 前端：React + Vite + TS
│  └─ src/
│     ├─ App.tsx        总装与交互
│     ├─ components/    各界面组件
│     ├─ search.ts      客户端检索（与服务端一致）
│     └─ markdown.tsx   轻量 markdown 渲染
├─ desktop/       # 桌面端：Electron 启动本地服务并加载前端
└─ package.json   # 根目录便捷脚本
```

## 快速开始

需要 **Node.js 20 或更新版本**（推荐 22）。后端数据库统一用 `@libsql/client`（libSQL），本地场景无需联网。

最简单的方式是用根目录脚本一键启动：

```bash
./restart.sh         # 首次会自动装依赖，并启动前后端；Ctrl+C 一起停止
./restart.sh stop    # 仅停止
```

也可以手动操作：

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

## 桌面端

项目已支持 Electron 桌面端。桌面端会启动一个仅监听本机的本地服务，再加载打包后的前端页面。开发模式默认继续使用 `server/data/knowledge.db`；安装后的桌面应用默认写入 macOS 应用数据目录，也可以通过 `DB_PATH` 或 Turso 环境变量接入同一份知识库数据。

首次使用先安装依赖：

```bash
npm run install:all
```

启动桌面端：

```bash
npm run desktop
```

该命令会先执行 `npm run build`，再打开「知识检索」桌面窗口。运行期间可在任意应用中按 `Alt+K` 呼出 / 收起快捷搜索浮窗，按 `Alt+J` 呼出关键点标签面板。桌面端默认从 `127.0.0.1:51730` 起寻找可用端口；如需指定端口，可设置 `IK_DESKTOP_PORT=端口号`。

打包成 macOS DMG：

```bash
npm run dist:dmg
```

生成文件在 `release/` 目录。安装后的桌面应用会把本地数据库写到 macOS 应用数据目录，不会写入 `.app` 包内部。

### GitHub 自动发布与更新

仓库已配置 GitHub Actions：

- 推送到 `main` 分支会自动构建 macOS arm64 DMG，并作为 Actions artifact 保留 14 天，适合日常提交后下载测试。
- 推送 `v*` 标签会自动构建并发布到 GitHub Release，桌面端自动更新只认这种正式发布版本。

日常提交触发构建：

```bash
git push origin main
```

正式发布触发自动更新：

```bash
git tag v1.0.1
git push origin v1.0.1
```

正式发布时流水线会上传：

- `interview-knowledge-desktop-版本号.dmg`：给用户下载安装。
- `interview-knowledge-desktop-版本号-arm64-mac.zip` 与 `latest-mac.yml`：给桌面端自动更新使用。

桌面端启动后会自动检查 GitHub Release 最新版本；也可以在菜单中点击「检查更新...」。检测到新版本时会弹出提示，点击「更新」会下载更新，下载完成后点击「立即安装」即可重启并完成更新。

## 打包成浏览器扩展

项目已支持生成 Chrome / Edge Manifest V3 扩展。扩展会打包现有 React 前端，后端仍使用本机或线上部署的 API 服务。

```bash
npm run build:extension
```

生成目录为 `dist-extension/`。在 Chrome / Edge 中打开扩展管理页，启用「开发者模式」，选择「加载已解压的扩展程序」，选中 `dist-extension/` 即可。

加载后可以用两种方式使用：

- 在任意网页按 `Alt+K`，页面上方会弹出悬浮搜索框，输入关键词后可直接查看知识点详情。
- 在搜索框输入英文句号 `.` 或中文句号 `。` 可打开知识库选择器，限定搜索范围。
- 按 `Alt+J` 可直接呼出 / 收起关键点标签面板。
- 点击扩展图标，可选择「在当前页面搜索」「打开侧边栏」或「在标签页打开」。

如果 `Alt+K` 或 `Alt+J` 和已有快捷键冲突，可在 `chrome://extensions/shortcuts` 中修改「呼出知识检索悬浮框」或「呼出知识检索关键点」的快捷键。

扩展默认连接 `http://localhost:5173/api`，所以本机使用时先启动后端：

```bash
npm start
```

如果后端部署在线上，点扩展弹窗里的「配置后端地址」，把 API 地址改成线上服务地址即可，例如 `https://your-service.onrender.com/api`。如果地址只填到站点根路径，扩展会自动补 `/api`。

## 数据存储

统一用 **libSQL**（`@libsql/client`），一套代码按环境变量切场景：

- **本地场景（默认）**：不设任何数据库变量，默认 `file:./data/knowledge.db`（离线、零网络、可直接读现有库文件）。也可用 `DB_PATH=./data/knowledge.db` 显式指定（兼容旧变量，会自动转成 `file:` 前缀）。
- **远程场景**：设 `TURSO_DATABASE_URL=libsql://<db>.turso.io` 与 `TURSO_AUTH_TOKEN=<token>`，数据持久、可跨实例共享，适合线上部署。
- 启动时按版本补充新增的内置知识库（`seed_migrations` 记录版本，幂等）；新建的知识点写入数据库，永久保留。
- 本地首次启动会在 `server/data/` 下创建库文件；远程首次启动会自动把 `server/src/seed-data/` 内置知识库播种到空库。

详见 `server/.env.example` 与下文「部署到 Render + Turso」。

## 部署到 Render + Turso（免费、数据持久）

无服务器 / 数据库也能上线：用 [Render](https://render.com) 托管服务 + [Turso](https://turso.tech) 提供免费远程 SQLite。两者都有免费额度。

### 1. 建 Turso 远程数据库

本地装 Turso CLI 后：

```bash
turso db create zhishi                       # 建库（首次会引导登录 / 关联 GitHub）
turso db show zhishi --url                   # 得到 TURSO_DATABASE_URL，形如 libsql://zhishi-xxx.turso.io
turso db tokens create zhishi                # 得到 TURSO_AUTH_TOKEN
```

### 2. 部署到 Render

仓库根已有 `render.yaml`（Blueprint）。把仓库推到 GitHub 后，在 Render 选 **New → Blueprint**，选中本仓库，Render 会自动识别。首次创建后，在服务的 **Environment** 里填：

| 变量 | 值 | 必填 |
| --- | --- | --- |
| `TURSO_DATABASE_URL` | 上一步的 `libsql://...` | 是 |
| `TURSO_AUTH_TOKEN` | 上一步的 token | 是 |
| `AUTH_TOKEN` | 管理登录令牌，使用高强度随机串 | 是 |
| `AI_API_KEY` / `AI_BASE_URL` / `AI_MODEL` | 见「AI 问答接入」 | 否 |
| `NODE_VERSION` | `22`（`render.yaml` 已默认） | — |

Render 的构建命令 `npm run install:all && npm run build`、启动命令 `npm start` 都已在 `render.yaml` 里配好。部署成功后访问 Render 给的 `https://<service>.onrender.com`，首次启动会自动播种内置知识库。

> 免费版 Web Service 会在 15 分钟无访问后休眠，首次唤醒有约 30–60s 冷启动；数据库（Turso）始终在线，数据不会丢。
> 若想把本地已有数据搬到线上：本地跑起来后用管理页「导出」，再对着线上实例「导入」即可。

## AI 问答接入（可选）

复制 `server/.env.example` 为 `server/.env` 并填入：

```
AI_API_KEY=sk-xxxx
AI_BASE_URL=https://api.openai.com/v1   # 可换成任意 OpenAI 兼容服务
AI_MODEL=gpt-4o-mini
```

未配置时，AI 弹窗会提示「未配置」，其余功能不受影响。线上默认要求登录后才能调用 `/api/ask`，避免公开消耗额度；确认要开放给所有访客时再设置 `AI_PUBLIC_ASK=true`。

## 数据模型

知识点的索引是**结构化的一等数据**（不再解析 markdown `##`）。每条知识点为：

```
{ id, cat, title, py, tags, summary,
  intro,                       // 索引前引言
  nodes: IndexNode[],          // 多级索引：{ id, title, content, children: IndexNode[] }
  sort, createdAt, updatedAt }
```

存储为 SQLite，索引以 JSON 存在 `idx` 列。旧库 / 旧种子的 markdown 正文在首次启动时一次性转换为结构化索引（保留 `body` 列仅作迁移兼容）。

## API 一览

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/entries` | 全部知识点 |
| GET | `/api/search?q=` | 检索 |
| GET | `/api/entries/:id` | 单条 |
| POST | `/api/entries` | 新建 |
| PUT | `/api/entries/:id` | 更新（改标题自动重算拼音、空摘要自动派生） |
| DELETE | `/api/entries/:id` | 删除 |
| POST | `/api/entries/reorder` | 拖拽排序，body `{ ids }` |
| GET | `/api/export` | 导出全部（备份） |
| POST | `/api/import` | 批量导入，body `{ entries, replace }` |
| POST | `/api/ask` | AI 问答（默认需登录；`AI_PUBLIC_ASK=true` 时公开） |

## 测试

核心纯逻辑（检索评分、索引解析/规范化、拼音 needles、画布建模/布局、索引树操作）有单元测试：

```bash
npm --prefix server test   # 服务端：node:test
npm --prefix web test      # 前端：node:test（需先 npm install）
```
