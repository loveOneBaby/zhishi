#!/usr/bin/env bash
# 一键重启前后端开发服务
# 用法：  ./restart.sh        启动（会先杀掉占用端口的旧进程）
#        ./restart.sh stop   只停止，不重启
set -euo pipefail

cd "$(dirname "$0")"

SERVER_PORT="${PORT:-5173}"
WEB_PORT="${WEB_PORT:-3000}"
LOG_DIR=".logs"
mkdir -p "$LOG_DIR"

kill_port() {
  local port="$1"
  local pids
  pids="$(lsof -ti tcp:"$port" 2>/dev/null || true)"
  if [ -n "$pids" ]; then
    echo "  · 停止占用端口 $port 的进程: $pids"
    kill $pids 2>/dev/null || true
    sleep 1
    # 仍在运行则强杀
    pids="$(lsof -ti tcp:"$port" 2>/dev/null || true)"
    [ -n "$pids" ] && kill -9 $pids 2>/dev/null || true
  fi
}

echo "==> 停止旧服务"
kill_port "$SERVER_PORT"
kill_port "$WEB_PORT"

if [ "${1:-}" = "stop" ]; then
  echo "已停止。"
  exit 0
fi

# 依赖未装好则自动安装（用关键包是否存在判断，避免上次安装中断导致的半成品）
if [ ! -d "server/node_modules/express" ]; then
  echo "==> 安装后端依赖"
  npm --prefix server install
fi
if [ ! -d "web/node_modules/vite" ]; then
  echo "==> 安装前端依赖"
  npm --prefix web install
fi

echo "==> 启动后端 (:$SERVER_PORT)"
PORT="$SERVER_PORT" npm --prefix server run dev > "$LOG_DIR/server.log" 2>&1 &
SERVER_PID=$!

echo "==> 启动前端 (:$WEB_PORT)"
npm --prefix web run dev > "$LOG_DIR/web.log" 2>&1 &
WEB_PID=$!

cleanup() {
  echo ""
  echo "==> 正在停止服务…"
  kill "$SERVER_PID" "$WEB_PID" 2>/dev/null || true
  kill_port "$SERVER_PORT"
  kill_port "$WEB_PORT"
  exit 0
}
trap cleanup INT TERM

echo ""
echo "前端:  http://localhost:$WEB_PORT"
echo "后端:  http://localhost:$SERVER_PORT/api/entries"
echo "日志:  $LOG_DIR/server.log  /  $LOG_DIR/web.log"
echo "按 Ctrl+C 停止两个服务。"
echo ""

# 跟踪日志，保持脚本在前台
wait
