# Zhishi 部署说明

## 目标环境

- 服务器：阿里云 ECS
- 登录用户：`work`
- 工作目录：`/home/work`
- Node.js：20+（服务器当前使用 `/home/work/runtime/node/bin/node`）
- 生产服务：`zhishi.service`
- 应用端口：`8788`
- 域名：`https://zhishi.cflj.top`

## 服务器目录

```text
/home/work/
├── apps/
│   └── zhishi/
│       ├── server/
│       │   ├── dist/              # 后端构建产物
│       │   ├── data/              # SQLite 数据库
│       │   └── .env               # 服务器配置，不纳入 Git
│       └── web/
│           └── dist/              # 前端构建产物
├── backups/                       # 手工备份
├── archive/                       # 历史归档
└── docs/                          # 服务器运维文档
```

数据库和 `server/.env` 是服务器状态，部署时必须保留，不能用本地文件覆盖。

## 本地运行

```bash
npm run install:all
npm run dev:server
npm run dev:web
```

## 本地构建检查

```bash
npm --prefix web ci
npm --prefix server ci
npm run build
```

## 自动部署

推送到 `main` 会触发 `.github/workflows/deploy-aliyun.yml`：

1. GitHub Actions 安装依赖
2. 构建前端和后端
3. 上传生产构建产物到 `/home/work/apps/zhishi`
4. 保留服务器 `.env` 和数据库
5. 重启 `zhishi.service`
6. 检查 `/api/health`

GitHub Actions 所需 Secrets：

- `ALIYUN_HOST`
- `ALIYUN_USER`
- `ALIYUN_PORT`
- `ALIYUN_SSH_PRIVATE_KEY`

部署命令：

```bash
git push origin main
```

## systemd

服务文件：`/etc/systemd/system/zhishi.service`

```bash
sudo systemctl status zhishi
sudo systemctl restart zhishi
sudo journalctl -u zhishi -n 100 --no-pager
```

健康检查：

```bash
curl -fsS http://127.0.0.1:8788/api/health
```

## Nginx 和 HTTPS

配置文件：`/etc/nginx/conf.d/zhishi-domain.conf`

转发关系：

```text
zhishi.cflj.top:80/443 → 127.0.0.1:8788
```

修改 Nginx 后执行：

```bash
sudo nginx -t
sudo systemctl reload nginx
```

证书由 Certbot 自动续期，证书目录为：

```text
/etc/letsencrypt/live/zhishi.cflj.top/
```

## 回滚和备份

每次自动部署前会备份到：

```text
/home/work/apps/zhishi/.deploy-backups/
```

手工整理归档位于：

```text
/home/work/archive/
```

回滚前先停止服务、确认备份内容，再恢复数据库或构建产物。不要执行针对整个 `/home/work` 的递归删除。

## 安全要求

- 不在仓库、文档或日志中保存 `AUTH_TOKEN`、数据库密码、OAuth Secret 或 SSH 私钥。
- 不覆盖服务器上的 `server/.env` 和 `server/data/knowledge.db`。
- 正常域名访问走 Nginx 的 80/443；8788 不应作为主要公网入口。
- 修改服务或 Nginx 后必须执行健康检查。
