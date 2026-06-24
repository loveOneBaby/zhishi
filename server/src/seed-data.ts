// 内置知识库种子数据（来自原 demo BUILTIN）
// 服务端首次启动时会把这些数据导入 SQLite。

export interface SeedEntry {
  id: string;
  cat: string;
  title: string;
  py: string; // 拼音 / 缩写，用于检索
  tags: string[];
  summary: string;
  body: string; // 轻量 markdown（## 小标题 / - 列表 / **加粗** / `代码` / ```代码块```）
}

export const SEED_ENTRIES: SeedEntry[] = [
  { id: 'fe1', cat: '前端', title: '闭包', py: 'bibao bb closure', tags: ['JS', '作用域'], summary: '函数能记住并访问其词法作用域，即使在作用域外执行。', body: '闭包是指**函数**能够访问其定义时所在的词法作用域，即便该函数在其他位置被调用。\n\n## 形成条件\n- 函数嵌套\n- 内部函数引用了外部函数的变量\n- 内部函数被返回或传递到外部\n\n## 常见用途\n- 数据私有化（模块模式）\n- 函数柯里化、防抖节流\n- 保存循环中的状态\n\n```js\nfunction counter() {\n  let n = 0;\n  return () => ++n;\n}\n```\n\n注意：闭包会延长变量生命周期，使用不当可能造成内存泄漏。' },
  { id: 'fe2', cat: '前端', title: '事件循环', py: 'shijianxunhuan sjxh eventloop', tags: ['JS', '异步'], summary: '宏任务 / 微任务的执行机制，决定异步代码的执行顺序。', body: 'JS 是单线程的，通过**事件循环**处理异步。\n\n## 执行顺序\n- 执行同步代码（调用栈）\n- 清空所有**微任务**（Promise.then、queueMicrotask）\n- 取一个**宏任务**（setTimeout、I/O、事件）\n- 重复\n\n## 关键点\n- 每个宏任务后都会清空微任务队列\n- `async/await` 本质是 Promise 的语法糖\n- 微任务优先级高于宏任务' },
  { id: 'fe3', cat: '前端', title: '原型链', py: 'yuanxinglian yxl prototype', tags: ['JS'], summary: '对象通过 __proto__ 逐级向上查找属性，构成继承链。', body: '每个对象都有一个内部指针 `__proto__` 指向其构造函数的 `prototype`。\n\n## 查找过程\n- 访问属性时，先查自身\n- 找不到则沿 `__proto__` 向上\n- 直到 `Object.prototype`，再上是 `null`\n\n## 要点\n- `instanceof` 基于原型链判断\n- `class` 是原型继承的语法糖\n- `Object.create(proto)` 显式指定原型' },
  { id: 'fe4', cat: '前端', title: '防抖与节流', py: 'fangdoujieliu fdjl debounce throttle', tags: ['JS', '性能'], summary: '控制高频事件触发频率的两种优化手段。', body: '## 防抖 debounce\n触发后等待一段时间，期间再次触发则重新计时。适合：搜索输入、窗口 resize。\n\n## 节流 throttle\n固定时间间隔内只执行一次。适合：滚动加载、按钮防连点。\n\n```js\nconst debounce = (fn, t) => {\n  let timer;\n  return (...a) => {\n    clearTimeout(timer);\n    timer = setTimeout(() => fn(...a), t);\n  };\n};\n```' },
  { id: 'fe5', cat: '前端', title: '虚拟 DOM', py: 'xunidom xndom vdom virtualdom', tags: ['框架'], summary: '用 JS 对象描述 DOM，通过 diff 计算最小更新。', body: '虚拟 DOM 是用 JS 对象对真实 DOM 的轻量描述。\n\n## 优势\n- 批量、最小化真实 DOM 操作\n- 跨平台（可渲染到原生、canvas）\n- 声明式编程\n\n## diff 策略\n- 同层比较，不跨层级\n- 通过 `key` 复用同类节点\n- 类型不同直接替换子树' },
  { id: 'fe6', cat: '前端', title: '重排与重绘', py: 'zhongpaizhonghui zpzh reflow repaint', tags: ['浏览器', '性能'], summary: 'reflow 重新计算布局，repaint 重新绘制像素。', body: '## 重排 reflow\n几何属性变化（宽高、位置）触发，开销大，会引起重绘。\n\n## 重绘 repaint\n仅样式变化（颜色、背景），不影响布局。\n\n## 优化\n- 批量修改样式（用 class 切换）\n- 读写分离，避免强制同步布局\n- 使用 `transform`/`opacity` 走合成层' },
  { id: 'fe7', cat: '前端', title: '跨域与 CORS', py: 'kuayu ky cors', tags: ['网络'], summary: '同源策略限制，及 CORS、代理等解决方案。', body: '浏览器**同源策略**限制不同源（协议+域名+端口）的请求。\n\n## 解决方案\n- **CORS**：服务端设置 `Access-Control-Allow-Origin`\n- **代理**：开发用 devServer，生产用 Nginx\n- **JSONP**：仅支持 GET（老方案）\n\n## 预检请求\n非简单请求会先发 `OPTIONS` 预检。' },
  { id: 'fe8', cat: '前端', title: 'CSS 盒模型', py: 'hemoxing hmx boxmodel', tags: ['CSS'], summary: 'content / padding / border / margin 的尺寸计算。', body: '## 标准盒模型\n`width` 只含内容区，总宽 = width + padding + border。\n\n## 怪异盒模型\n`box-sizing: border-box`，width 包含 padding 和 border，更直观。\n\n推荐全局设置 `* { box-sizing: border-box; }`。' },

  { id: 'jv1', cat: 'Java', title: 'JVM 内存模型', py: 'jvm neicun ncmx neicunmoxing', tags: ['JVM'], summary: '堆、栈、方法区、程序计数器等运行时数据区。', body: '## 运行时数据区\n- **堆**：对象实例，GC 主要区域，线程共享\n- **虚拟机栈**：方法的栈帧（局部变量、操作数栈），线程私有\n- **方法区/元空间**：类信息、常量、静态变量\n- **程序计数器**：当前执行字节码行号\n- **本地方法栈**：native 方法\n\n## 堆分代\n新生代（Eden + 2 Survivor）+ 老年代。' },
  { id: 'jv2', cat: 'Java', title: 'GC 垃圾回收', py: 'lajihuishou ljhs gc garbage', tags: ['JVM'], summary: '可达性分析判定垃圾，分代收集 + 各类收集器。', body: '## 判定垃圾\n**可达性分析**：从 GC Roots 不可达的对象可回收（不用引用计数，避免循环引用）。\n\n## 回收算法\n- 标记-清除（碎片）\n- 标记-复制（新生代）\n- 标记-整理（老年代）\n\n## 收集器\nG1、CMS、ZGC（低延迟）。' },
  { id: 'jv3', cat: 'Java', title: 'synchronized', py: 'synchronized tongbu suo lock', tags: ['并发'], summary: '基于对象监视器的同步，含锁升级机制。', body: '`synchronized` 保证同一时刻只有一个线程进入临界区。\n\n## 锁升级\n无锁 → **偏向锁** → **轻量级锁**（CAS 自旋）→ **重量级锁**（操作系统互斥量）。\n\n## 特性\n- 可重入\n- 保证可见性与原子性\n- 释放锁会刷新工作内存' },
  { id: 'jv4', cat: 'Java', title: '线程池', py: 'xianchengchi xcc threadpool', tags: ['并发'], summary: 'ThreadPoolExecutor 七参数与任务处理流程。', body: '## 核心参数\n核心线程数、最大线程数、空闲存活时间、时间单位、阻塞队列、线程工厂、拒绝策略。\n\n## 执行流程\n- 核心线程未满 → 创建核心线程\n- 已满 → 入队列\n- 队列满且未达最大 → 创建非核心线程\n- 再满 → 触发**拒绝策略**\n\n避免用 Executors 快捷方法（队列/线程无界风险），手动 new。' },
  { id: 'jv5', cat: 'Java', title: 'HashMap 原理', py: 'hashmap', tags: ['集合'], summary: '数组 + 链表 + 红黑树，扰动函数与扩容。', body: '## 结构\n数组 + 链表，链表长度 ≥ 8 且容量 ≥ 64 时转**红黑树**。\n\n## 关键点\n- 扰动函数：高位参与运算减少碰撞\n- 默认容量 16，负载因子 0.75\n- 扩容翻倍，重新分布（JDK8 用高低位拆分）\n- 非线程安全，并发用 ConcurrentHashMap' },
  { id: 'jv6', cat: 'Java', title: 'Spring IOC', py: 'spring ioc kongzhifanzhuan di', tags: ['Spring'], summary: '控制反转与依赖注入，由容器管理 Bean。', body: '**IOC（控制反转）**：对象的创建和依赖关系交给容器管理。\n\n## DI 注入方式\n- 构造器注入（推荐）\n- Setter 注入\n- 字段注入（@Autowired）\n\n## Bean 生命周期\n实例化 → 属性填充 → 初始化（Aware、BeanPostProcessor、init）→ 使用 → 销毁。' },
  { id: 'jv7', cat: 'Java', title: '事务隔离级别', py: 'shiwugeli swgl isolation transaction', tags: ['数据库', '事务'], summary: '四种隔离级别与脏读、不可重复读、幻读。', body: '## 隔离级别（由低到高）\n- 读未提交：脏读\n- 读已提交：解决脏读\n- 可重复读：解决不可重复读（MySQL 默认，MVCC + 间隙锁基本解决幻读）\n- 串行化：完全隔离\n\n## 三类问题\n脏读、不可重复读、幻读。' },
  { id: 'jv8', cat: 'Java', title: '数据库索引', py: 'suoyin sy index btree', tags: ['数据库'], summary: 'B+ 树索引、聚簇/非聚簇、最左前缀。', body: '## B+ 树\n叶子节点存数据/主键且双向链表相连，适合范围查询，树矮查询稳定。\n\n## 类型\n- **聚簇索引**：主键，叶子存整行\n- **非聚簇/二级索引**：叶子存主键，需回表\n\n## 最左前缀\n联合索引从最左列开始匹配，遇范围查询中断。' },
  { id: 'jv9', cat: 'Java', title: 'Redis 持久化', py: 'redis chijiuhua cjh rdb aof', tags: ['缓存'], summary: 'RDB 快照与 AOF 日志两种机制。', body: '## RDB\n定时生成内存快照，体积小、恢复快，但可能丢最后一次快照后的数据。\n\n## AOF\n记录写命令，可配置同步策略（always/everysec/no），数据更安全、文件大。\n\n## 混合持久化\nRDB 全量 + AOF 增量，兼顾速度与安全（Redis 4.0+）。' },
  { id: 'jv10', cat: 'Java', title: '消息队列', py: 'xiaoxiduilie xxdl mq kafka', tags: ['中间件'], summary: '解耦、异步、削峰，及重复/丢失/顺序问题。', body: '## 核心作用\n- 解耦：生产消费分离\n- 异步：提升响应速度\n- 削峰：缓冲突发流量\n\n## 常见问题\n- 重复消费 → 消费幂等\n- 消息丢失 → 持久化 + ACK + 重试\n- 顺序消费 → 单分区/单队列' },

  { id: 'cs1', cat: '基础', title: 'TCP 三次握手', py: 'tcp sanciwoshou scws handshake woshou', tags: ['网络'], summary: '建立连接需三次交互，确认双方收发能力。', body: '## 过程\n- 客户端发 **SYN**\n- 服务端回 **SYN + ACK**\n- 客户端回 **ACK**，连接建立\n\n## 为什么三次\n两次无法确认客户端的接收能力，也无法防止历史失效连接请求建立连接。\n\n断开需**四次挥手**（FIN 单独确认）。' },
  { id: 'cs2', cat: '基础', title: 'HTTP 与 HTTPS', py: 'http https', tags: ['网络'], summary: 'HTTPS = HTTP + TLS，加密 + 身份认证。', body: '## HTTPS 加密流程\n- TLS 握手协商对称密钥（非对称加密传输）\n- 后续用对称加密通信\n- 证书由 CA 签发，验证服务端身份\n\n## 区别\n- 端口 80 / 443\n- HTTPS 防窃听、防篡改、防冒充' },
  { id: 'cs3', cat: '基础', title: '进程与线程', py: 'jincheng xiancheng jcxc process thread', tags: ['操作系统'], summary: '进程是资源分配单位，线程是调度单位。', body: '## 区别\n- **进程**：独立地址空间，资源分配的基本单位，切换开销大\n- **线程**：共享进程内存，CPU 调度的基本单位，切换开销小\n\n## 通信\n- 进程：管道、消息队列、共享内存、信号、Socket\n- 线程：共享内存 + 同步机制' },
  { id: 'cs4', cat: '基础', title: '死锁', py: 'sisuo deadlock suosi', tags: ['操作系统', '并发'], summary: '四个必要条件及预防、避免策略。', body: '## 四个必要条件\n- 互斥\n- 请求与保持\n- 不可剥夺\n- 循环等待\n\n## 处理\n- **预防**：破坏任一条件（如按序申请资源破坏循环等待）\n- **避免**：银行家算法\n- **检测 + 恢复**：资源分配图' },

  { id: 'al1', cat: '算法', title: '快速排序', py: 'kuaisupaixu kspx quicksort kuaipai', tags: ['排序'], summary: '分治 + 基准划分，平均 O(n log n)。', body: '## 思想\n选基准 pivot，划分为左小右大两部分，递归处理。\n\n## 复杂度\n- 平均 O(n log n)，最坏 O(n²)（已有序）\n- 原地排序，空间 O(log n)\n- 不稳定\n\n## 优化\n随机基准 / 三数取中，避免最坏情况。' },
  { id: 'al2', cat: '算法', title: '二分查找', py: 'erfenchazhao efcz binarysearch erfen', tags: ['查找'], summary: '有序数组中 O(log n) 定位目标。', body: '前提：数组必须**有序**，每次将搜索区间折半。\n\n## 实现\n```js\nfunction bs(a, t) {\n  let l = 0, r = a.length - 1;\n  while (l <= r) {\n    const m = (l + r) >> 1;\n    if (a[m] === t) return m;\n    a[m] < t ? l = m + 1 : r = m - 1;\n  }\n  return -1;\n}\n```\n\n## 边界要点\n- 循环条件 `l <= r`\n- 收缩用 `m+1` / `m-1`，防止死循环\n- 中点用 `(l + r) >> 1` 或 `l + (r-l)/2` 防溢出\n\n## 复杂度\n- 时间 O(log n)，空间 O(1)' },
];
