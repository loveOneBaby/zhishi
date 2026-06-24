import type { SeedEntry } from './types.js';

export const FUNDAMENTAL_ENTRIES: SeedEntry[] = [
  { id: 'cs1', cat: '基础', title: 'TCP 三次握手', py: 'tcp sanciwoshou scws handshake woshou', tags: ['网络'], summary: '建立连接需三次交互，确认双方收发能力。', body: '## 过程\n- 客户端发 **SYN**\n- 服务端回 **SYN + ACK**\n- 客户端回 **ACK**，连接建立\n\n## 为什么三次\n两次无法确认客户端的接收能力，也无法防止历史失效连接请求建立连接。\n\n断开需**四次挥手**（FIN 单独确认）。' },
  { id: 'cs2', cat: '基础', title: 'HTTP 与 HTTPS', py: 'http https', tags: ['网络'], summary: 'HTTPS = HTTP + TLS，加密 + 身份认证。', body: '## HTTPS 加密流程\n- TLS 握手协商对称密钥（非对称加密传输）\n- 后续用对称加密通信\n- 证书由 CA 签发，验证服务端身份\n\n## 区别\n- 端口 80 / 443\n- HTTPS 防窃听、防篡改、防冒充' },
  { id: 'cs3', cat: '基础', title: '进程与线程', py: 'jincheng xiancheng jcxc process thread', tags: ['操作系统'], summary: '进程是资源分配单位，线程是调度单位。', body: '## 区别\n- **进程**：独立地址空间，资源分配的基本单位，切换开销大\n- **线程**：共享进程内存，CPU 调度的基本单位，切换开销小\n\n## 通信\n- 进程：管道、消息队列、共享内存、信号、Socket\n- 线程：共享内存 + 同步机制' },
  { id: 'cs4', cat: '基础', title: '死锁', py: 'sisuo deadlock suosi', tags: ['操作系统', '并发'], summary: '四个必要条件及预防、避免策略。', body: '## 四个必要条件\n- 互斥\n- 请求与保持\n- 不可剥夺\n- 循环等待\n\n## 处理\n- **预防**：破坏任一条件（如按序申请资源破坏循环等待）\n- **避免**：银行家算法\n- **检测 + 恢复**：资源分配图' },
];
