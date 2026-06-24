import type { SeedEntry } from './types.js';

function md(strings: TemplateStringsArray, ...values: string[]): string {
  return strings.reduce((result, part, index) => result + part + (values[index] ?? ''), '').trim();
}

const BASE = 'https://xiaolinnote.com/ai';

export const AI_ENTRIES: SeedEntry[] = [
  {
    id: 'ai1',
    cat: 'AI',
    title: 'Agent',
    py: 'ai agent zhinengti react plan execute reflection planning memory workflow tools multi agent orchestrator handoff shared state',
    tags: ['Agent', 'Multi-Agent', '面试主线', '架构范式'],
    summary: '先回答 Agent 的边界，再展开组件、推理范式、规划、记忆、多 Agent 协作和工程取舍。',
    body: md`
来源覆盖[小林 Agent 面试专题](${BASE}/agent/agent_info.html)中基础概念、设计范式、任务拆分、规划、记忆、反思、多 Agent 协作和手搓框架等问题。面试时不要从名词开始背，要先讲清楚“为什么需要 Agent、它比 LLM 多了什么控制闭环”。

## 定位与边界
面试官先看你是否能把 LLM、Agent、Workflow、Tools 分清楚，这是后面所有追问的地基。

### [Agent vs LLM](${BASE}/agent/1_whatisagent.html)
LLM 负责理解和生成，Agent 在 LLM 外层增加目标、状态、工具、记忆和反馈循环；关键差别是 Agent 能根据观察继续决策，而不是一次性生成答案。

### [Workflow vs Agent vs Tools](${BASE}/agent/3_workflow_tools.html)
Tools 是原子能力；Workflow 是预设流程，稳定可控；Agent 是动态决策循环，适合路径不确定任务。生产里常见的是 Agentic Workflow：主流程固定，局部交给 Agent 决策。

### [什么时候不用 Agent](${BASE}/agent/4_patterns.html)
如果任务路径稳定、输入输出规则明确，用 Workflow 更便宜、更可测；只有当任务需要动态判断、工具选择、反复观察时，Agent 才值得引入。

## 核心架构
回答组件时要讲职责边界，不要只列四个名词。

### [LLM](${BASE}/agent/2_components.html)
LLM 是推理与决策核心，负责理解目标、判断下一步和生成结构化动作；它不直接执行外部副作用，执行权应由宿主系统控制。

### Tools
工具把搜索、数据库、代码执行和业务 API 暴露成可校验的能力。面试追问点是工具描述、参数 Schema、权限、超时、重试和结果注入方式。

### Memory
记忆不是把历史全塞进上下文，而是决定写什么、存哪里、何时检索。要区分任务态短期记忆和可复用长期记忆。

### Planning
规划不是自然语言待办列表，应包含步骤、依赖、完成条件、失败处理和是否需要 Replan。

## 推理范式
这部分是 Agent 高频考点，重点不是背定义，而是能讲清适用场景与风险。

### [ReAct](${BASE}/agent/5_react.html)
按“思考 → 行动 → 观察”循环执行。优点是灵活、可解释、容易插工具；缺点是长任务易跑偏、重复调用、上下文膨胀。

### [Plan-and-Execute](${BASE}/agent/6_three_patterns.html)
先生成全局计划，再按步骤执行。适合长链路复杂任务，也可强模型规划、低成本模型执行；风险是初始计划错误会被放大。

### [Reflection](${BASE}/agent/15_reflection.html)
在执行后加入“生成 → 评估 → 改进”闭环。它是质量增强机制，不是所有任务都必须套一层反思；适合代码、写作、复杂推理等可评估任务。

### Dynamic Replan / Reflexion
Dynamic Replan 是执行中重新修正计划；Reflexion 是把失败经验写入记忆，后续任务检索复用。面试要说明二者一个偏当前任务，一个偏跨任务经验。

## 任务拆分与规划能力
复杂任务考的是控制能力：拆得太粗不可控，拆得太细成本高。

### [任务拆分](${BASE}/agent/7_tasksplit.html)
按依赖、职责、可验证产物拆分。好的子任务应有明确输入、输出、完成条件和失败回滚点。

### [CoT / ToT / GoT](${BASE}/agent/14_planning.html)
CoT 激活线性推理；ToT 同时探索多条思路；GoT 把中间结果做成可复用图结构。回答时要落到成本和任务复杂度，不要把高级方法当默认方案。

### 规划效果怎么提升
引入检查点、工具反馈、计划评分、阶段性 Replan 和终止条件；核心是把“模型说它完成了”改成“系统能验证它完成了”。

## 记忆机制
记忆题通常追问存储粒度、检索策略和上下文压缩。

### [记忆类型](${BASE}/agent/8_memory.html)
可按工作记忆、短期记忆、长期记忆、经验记忆理解。面试中重点说明当前任务状态与长期知识不能混在一起。

### [短期与长期记忆](${BASE}/agent/9_memory_storage.html)
短期记忆保存在上下文或任务状态里；长期记忆通常进入数据库、向量库或结构化存储，并通过语义检索或规则检索取回。

### [记忆压缩](${BASE}/agent/12_memcompress.html)
常见方案包括滑动窗口、摘要压缩、重要性筛选、结构化抽取、分层记忆和检索式记忆。风险是摘要丢关键细节，必须保留可追溯原文。

## Multi-Agent 协作
Multi-Agent 是 Agent 的扩展形态，不单独作为一级专题；面试关键是说明为什么要多 Agent，以及协作成本如何控制。

### [Single-Agent vs Multi-Agent](${BASE}/agent/11_single_multi.html)
任务简单、共享上下文强、路径连续时优先单体 Agent；角色专业化、上下文隔离、可并行执行或需要互评时再使用 Multi-Agent。

### [Multi-Agent 核心思路](${BASE}/agent/10_multiagent.html)
通过角色分工和协作完成单一 Agent 难以稳定处理的复杂任务。代价是通信、路由、冲突、状态一致性和成本都变复杂。

### 中心化 vs 去中心化
中心化 Orchestrator 易控、易观测，适合工程落地；去中心化更灵活，但容易出现职责重叠、循环协作和全局状态不可控。

### [传递信息](${BASE}/agent/16_collab.html#%E5%85%88%E8%AF%B4%E5%8D%8F%E4%BD%9C-agent-%E4%B9%8B%E9%97%B4%E6%80%8E%E4%B9%88%E4%BC%A0%E9%80%92%E4%BF%A1%E6%81%AF)
消息传递强调解耦，适合独立并行的 Agent；关键是消息 Schema、上下文摘要、任务 ID、来源和错误状态。

### 共享状态
共享状态适合前后依赖明确的流水线。要区分全局状态与局部状态，明确写入权限，优先增量追加，避免多个 Agent 覆盖同一字段。

### [Orchestrator 路由](${BASE}/agent/16_collab.html#%E5%86%8D%E8%AF%B4%E5%88%87%E6%8D%A2-orchestrator-%E6%80%8E%E4%B9%88%E5%86%B3%E5%AE%9A%E5%8F%AB%E8%B0%81)
静态规则稳定可预测，LLM 动态路由灵活但成本和误判更高。生产中常用静态主流程加动态兜底。

### [Handoff](${BASE}/agent/16_collab.html#handoff-%E6%A8%A1%E5%BC%8F-agent-%E4%B9%8B%E9%97%B4%E7%9A%84-%E6%8E%A5%E5%8A%9B%E6%A3%92)
Handoff 是当前 Agent 主动把任务交给下一角色。适合职责边界清晰的接力场景，但必须有防循环、最大跳转次数和终止条件。

### 状态 Schema
共享状态至少包括任务目标、当前阶段、已知事实、待解决问题、工具结果、错误、下一步建议。Schema 不清楚会导致 Agent 之间互相覆盖或误读。

### 冲突处理与可观测性
冲突处理要有仲裁规则：可信来源优先、证据强度优先、评审 Agent 复核或人工确认；每次调用记录角色、输入摘要、工具、输出、路由原因、成本和耗时。

### 什么场景不用 Multi-Agent
任务上下文高度耦合、角色边界模糊、输出不可并行验证时不要拆；拆了只会增加通信成本和错误传播。

## 工程落地
工程题要从可观测、可控、成本和失败治理回答。

### [手搓 Agent vs 框架](${BASE}/agent/13_handcode.html)
框架适合快速搭建通用流程；手搓适合强定制、可观测、权限、性能和依赖治理要求高的系统。不是“框架不好”，而是控制面不同。

### 线上风险
要准备工具误调、循环调用、权限越界、上下文污染、成本失控、长任务中断和不可复现等问题，并给出日志、Trace、预算阈值和终止条件。
`,
  },
  {
    id: 'ai2',
    cat: 'AI',
    title: 'RAG',
    py: 'rag retrieval augmented generation chunk embedding vector db rerank hallucination evaluation',
    tags: ['RAG', '检索', '工程落地'],
    summary: '按离线索引、在线检索、生成治理、评测更新四段梳理，突出工程取舍。',
    body: md`
来源覆盖[小林 RAG 面试专题](${BASE}/rag/rag_info.html)全部 20 个高频问题。面试回答要体现“用过”和“优化过”的区别：能不能讲清数据、检索、评测和线上反馈闭环。

## 系统闭环
开场题要能从文档进入系统一直讲到答案输出。

### [完整工作流](${BASE}/rag/1_whatisrag.html)
离线链路：解析清洗 → Chunking → Embedding → 写入向量库与元数据。在线链路：Query 理解 → 召回 → 融合 → 重排 → 上下文组装 → 生成 → 引用校验。

### [RAG 解决什么](${BASE}/rag/2_rag_problems.html)
解决知识过时、私有数据接入、事实可追溯和幻觉缓解；它不直接提升模型基础推理能力。

### [RAG vs 微调](${BASE}/rag/3_rag_vs_finetune.html)
RAG 解决“说什么”：动态知识、引用、低更新成本。微调解决“怎么说/怎么做”：稳定风格、任务格式和行为模式。二者经常组合。

## 索引构建
索引质量决定召回上限，面试官会追问切分、Embedding、向量库和元数据。

### [Chunking](${BASE}/rag/4_chunking.html)
固定大小简单稳定，标题结构切分更保语义，父子块兼顾召回粒度和上下文完整。Chunk 大小要通过评测调，不要拍脑袋。

### [规避语义切断](${BASE}/rag/5_semantic_cuts.html)
用重叠窗口、语义边界、句子窗口、父子 Chunk 和上下文扩展，避免定义、条件、结论被分到不同块。

### [Embedding 选型](${BASE}/rag/6_embedding.html)
结合语言、领域、维度、延迟、成本和自有检索集评估，不能只看公开榜单。真实项目要准备 Recall@K 或人工标注集。

### [Embedding 算法](${BASE}/rag/7_embedding_algos.html)
需要知道从静态词向量、上下文向量到句向量/对比学习的演进，以及稠密检索为什么能做语义匹配。

### [向量数据库选型](${BASE}/rag/8_vectordb.html)
关注索引算法、过滤能力、数据规模、更新频率、一致性、扩容、备份和运维成本，不只是 QPS。

### [向量库工程实践](${BASE}/rag/9_vectordb_practice.html)
面试要准备数据量、向量维度、Top-K、索引参数、过滤条件、延迟、召回率和遇到过的瓶颈。

## 检索优化
目标是让正确证据进入有限上下文，不是盲目增加 Top-K。

### [在线检索流程](${BASE}/rag/10_online_workflow.html)
Query 预处理 → Query Embedding → ANN 搜索/多路召回 → 结果融合 → Rerank → 去重压缩 → 上下文组装。

### [向量检索 vs 关键词检索](${BASE}/rag/11_retrieval_types.html)
向量检索擅长语义近似，BM25 擅长专有名词和精确匹配。生产系统常用混合检索，再用 RRF 或重排融合。

### [Query Rewrite](${BASE}/rag/12_query_rewrite.html)
补全指代、拆分多问题、生成同义表达、HyDE 或 Step-back Prompting；风险是改写偏离原意，需要保留原 Query 作为兜底。

### [多路召回](${BASE}/rag/13_multi_retrieval.html)
并行使用稠密、稀疏、规则、结构化、历史反馈等召回源，再做分数归一化、RRF 融合和去重。

### [Rerank 与检索调优](${BASE}/rag/14_retrieval_opt.html)
Cross-Encoder 或 LLM Reranker 用于精排，配合元数据过滤、时间过滤、权限过滤和上下文压缩。

### [高级 RAG 范式](${BASE}/rag/15_advanced_paradigms.html)
Self-RAG 加自评，Corrective RAG 加纠错，Agentic RAG 让 Agent 自主决定是否继续检索。质量更高，但成本和延迟上升。

### [GraphRAG](${BASE}/rag/16_graph_db.html)
适合实体关系、多跳推理、全局主题分析和知识网络。普通单跳问答不要为了技术栈复杂度强行上图数据库。

## 生成治理
RAG 幻觉分两类：检索没找到对证据，或模型没有忠实使用证据。

### [幻觉规避](${BASE}/rag/17_hallucination.html)
提供引用、设置低置信拒答、约束答案只能基于证据、生成后事实校验、关键场景加人工审核。

### 上下文组装
要控制证据顺序、去重、引用来源、Token 预算和冲突证据。上下文不是越多越好，噪声会降低答案质量。

### 引用与可追溯
答案应带来源片段、文档版本和权限信息；引用错误时用户会比“没有引用”更不信任系统。

## 评测与运营
生产落地要从效果、更新和反馈闭环回答。

### [效果评测](${BASE}/rag/18_evaluation.html)
检索看 Recall@K、MRR、nDCG；生成看正确性、相关性、忠实度和引用准确率；最终看业务成功率、拒答率和人工转接率。

### [知识库动态更新](${BASE}/rag/19_dynamic_update.html)
用内容哈希、文档版本、chunk ID、增量解析、删除同步、灰度索引和回滚机制保证更新期间结果一致。

### [最难的工程问题](${BASE}/rag/20_hardest_parts.html)
难点通常是文档预处理、检索调优、评测集构建和线上反馈闭环。能结合真实故障与指标回答，会比只讲架构图更可信。
`,
  },
  {
    id: 'ai3',
    cat: 'AI',
    title: 'LLM 工具调用',
    py: 'llm tools function calling mcp skill a2a gateway sse websocket webrtc',
    tags: ['Function Calling', 'MCP', '协议'],
    summary: '围绕谁决策、谁执行、如何连接、如何通信、如何治理工具生态来组织。',
    body: md`
来源覆盖[小林 LLM 工具调用专题](${BASE}/tools/tools_info.html)全部 16 个问题。面试关键是把 Function Calling、MCP、Skill、A2A 的层级关系讲清楚。

## 调用机制
先回答模型到底输出了什么，以及谁真正执行工具。

### [Function Calling 原理](${BASE}/tools/1_function_calling.html)
模型根据工具描述生成结构化调用意图和参数；宿主程序负责校验、鉴权、执行工具，并把结果返回模型。模型本身不直接执行外部操作。

### [模型如何学会调工具](${BASE}/tools/2_llm_tool_learning.html)
训练数据包含工具定义、调用参数、工具结果和最终回答轨迹。SFT 让模型学格式，偏好/强化阶段让模型学“该不该调”。

### [Function Call 训练](${BASE}/tools/3_fc_training.html)
核心考点是工具选择、参数构造、结果利用和不该调用时的拒绝边界。回答时要区分格式能力和决策能力。

## MCP
MCP 解决的是 AI 应用和外部能力之间的标准连接问题，不是模型内部能力。

### [MCP 是什么](${BASE}/tools/4_what_is_mcp.html)
MCP 标准化工具、资源和提示的发现与调用，让 AI 应用能用统一协议接入外部系统。

### [MCP 组件](${BASE}/tools/5_mcp_components.html)
Host 承载 AI 应用，Client 管理连接，Server 暴露 Tools、Resources、Prompts；底层消息通常是 JSON-RPC。

### [MCP vs Function Calling](${BASE}/tools/6_mcp_vs_fc.html)
Function Calling 是模型输出工具调用的交互机制；MCP 是应用连接工具生态的协议。实际系统中可以 MCP 供工具，Function Calling 决定何时调用。

### [FC 还是 MCP](${BASE}/tools/7_fc_vs_mcp_usage.html)
应用内少量固定工具可直接用 Function Calling；跨应用复用、动态发现、统一接入和生态扩展更适合 MCP。

### [推理模型兼容性](${BASE}/tools/8_reasoning_no_mcp.html)
要区分模型是否支持结构化工具调用，和应用是否接入 MCP。MCP 不等于模型会在推理内部自动跑协议。

### [MCP 通信方式](${BASE}/tools/13_mcp_transport.html)
本地常用 stdio，远程用基于 HTTP 的流式传输。传输层影响部署形态和连接治理，不改变 MCP 的语义。

## Skill 与 Agent 协议
这一层考的是工具生态之上的任务复用和 Agent 间协作。

### [Skill](${BASE}/tools/9_skill.html)
Skill 是可复用任务知识、步骤和资源的封装，更像操作手册，不是底层工具接口。

### [MCP vs Skill](${BASE}/tools/10_mcp_vs_skill.html)
MCP 给 Agent 一组标准化工具，Skill 告诉 Agent 如何组合这些工具完成任务。一个解决连接，一个解决流程知识复用。

### [FC / Skill / MCP](${BASE}/tools/11_fc_skill_mcp.html)
可用一句话串起来：FC 是调用语言，MCP 是工具箱，Skill 是操作流程。面试还要能说明各自运行在模型、应用和外部服务的哪个边界。

### [A2A](${BASE}/tools/12_a2a_protocol.html)
A2A 面向 Agent 与 Agent 的能力发现、任务委派和协作；MCP 主要解决 Agent 或应用与工具之间的连接。

## 通信协议
协议题通常从 MCP 或 AI 对话流延伸出来。

### [SSE vs WebSocket](${BASE}/tools/14_sse_vs_websocket.html)
SSE 是服务端到客户端的单向事件流，简单且适合文本流式输出；WebSocket 是双向实时通道，适合双向控制但连接治理更复杂。

### [WebRTC vs WebSocket](${BASE}/tools/15_webrtc_vs_ws.html)
WebRTC 面向低延迟音视频和点对点媒体传输，牺牲部分可靠性换延迟；WebSocket 更适合可靠的双向文本消息和控制信令。

## 工程治理
工具调用上生产一定会追问鉴权、限流、可观测和成本。

### [LLM Gateway](${BASE}/tools/16_llm_gateway.html)
网关统一多模型路由、鉴权、限流、重试、缓存、成本统计、Trace、降级和供应商故障切换，是线上 AI 应用的控制面。

### 工具安全边界
工具参数必须 Schema 校验，副作用工具要权限隔离和二次确认，高风险操作要审计。模型输出只能作为建议，不能直接获得执行权。
`,
  },
  {
    id: 'ai4',
    cat: 'AI',
    title: 'LLM 工程',
    py: 'llm transformer attention tokenizer training lora dpo ppo kv cache quantization prompt evaluation model selection',
    tags: ['LLM', '工程', '模型选型'],
    summary: '按架构原理、训练对齐、推理优化、应用可靠性、评测选型五条主线组织。',
    body: md`
来源覆盖[小林大模型工程专题](${BASE}/llm/llm_info.html)全部 22 个问题。面试官真正考的是你能否把底层原理和工程决策连起来。

## 基础原理
这是所有 LLM 工程追问的地基。

### [LLM vs 传统 NLP](${BASE}/llm/what_is_llm.html)
传统 NLP 常针对单任务训练，LLM 通过大规模自监督预训练把任务统一成下一个 token 预测，并获得上下文学习和生成能力。

### [Transformer](${BASE}/llm/transformer_architecture.html)
重点掌握 Self-Attention、Q/K/V、缩放点积、FFN、残差、归一化，以及 Encoder、Decoder、Decoder-only 的差别。

### [MHA / MQA / GQA / Flash Attention](${BASE}/llm/mha_mqa_gqa_flash_attention.html)
MHA 的瓶颈在 KV Cache 和显存带宽；MQA/GQA 通过共享 KV Head 降低缓存；Flash Attention 用 IO 感知分块减少显存读写。

### [位置编码](${BASE}/llm/position_encoding.html)
sin/cos 是绝对位置，RoPE 用旋转编码相对位置，ALiBi 直接给注意力分数加距离偏置。长上下文追问常从这里展开。

### [Tokenizer](${BASE}/llm/tokenizer.html)
Tokenizer 影响费用、上下文长度、多语言效果和未知词处理。要理解 BPE/子词切分，以及中文场景下 token 膨胀问题。

## 训练与对齐
回答训练流程要讲不同阶段的目标，不要混成“拿数据训一下”。

### [训练全流程](${BASE}/llm/llm_training.html)
预训练学习语言与知识，SFT 学会指令格式，对齐阶段优化人类偏好、安全性和推理行为。

### [Scaling Law 与涌现](${BASE}/llm/scaling_law_emergence.html)
性能受参数、数据和算力共同约束；涌现能力是规模扩大后某些任务突然可用，但也受评测定义影响。

### [微调方案](${BASE}/llm/finetuning.html)
全量微调上限高但成本大；PEFT 只训练少量参数，适合资源有限、多任务适配和快速迭代。

### [LoRA / QLoRA](${BASE}/llm/lora.html)
LoRA 用低秩增量近似权重更新；QLoRA 量化基座权重进一步降显存。追问点是秩、插入位置、合并权重和精度损失。

### [Post-Training](${BASE}/llm/post_training.html)
RLHF、DPO、GRPO、拒绝采样、RLAIF 的差别在数据来源、是否训练奖励模型、是否在线 RL 和优化稳定性。

### [DPO vs PPO](${BASE}/llm/dpo_vs_ppo.html)
DPO 直接从偏好对优化策略，流程简单稳定；PPO 是在线强化学习，控制力强但训练链路复杂、调参难。

## 推理与成本优化
这部分会和 Agent、RAG 项目经验强关联。

### [解码策略](${BASE}/llm/decoding_strategies.html)
贪心稳定但单一，Beam Search 适合确定性序列任务，开放式生成多用采样。面试要说明为什么 LLM 时代 Beam Search 不一定优。

### [Temperature / Top-P / Top-K](${BASE}/llm/temperature_top_p_top_k.html)
Temperature 调整分布平滑度，Top-K 限制候选数量，Top-P 限制累计概率集合。结构化任务通常低随机性，创意任务可提高随机性。

### [KV Cache 与 Prompt Caching](${BASE}/llm/kv_cache_prompt_caching.html)
KV Cache 避免解码时重复计算历史注意力；Prompt Caching 复用相同前缀的预填充结果，对多轮 Agent 能显著省成本。

### [量化](${BASE}/llm/quantization.html)
INT8/INT4 降低显存和带宽；AWQ/GPTQ 等方法在精度、速度、硬件支持和校准成本之间取舍。

### [部署框架选型](${BASE}/llm/deployment_frameworks.html)
vLLM 强在连续批处理和 PagedAttention，SGLang 强在多轮/共享前缀，TGI 贴近 HuggingFace 生态，llama.cpp 适合本地和边缘场景。

## 应用可靠性
应用层不是背 Prompt 模板，而是把输出稳定性工程化。

### [Prompt Engineering](${BASE}/llm/prompt_engineering.html)
好 Prompt 明确目标、上下文、约束、示例和输出格式；关键输出要 Schema 校验，并通过评测集迭代。

### [CoT](${BASE}/llm/cot.html)
CoT 通过中间推理提高复杂任务表现，但增加延迟和 token，不保证推理过程真实。生产中可用隐藏推理或让模型输出简洁依据。

### [幻觉](${BASE}/llm/hallucination.html)
根因是概率续写不是事实查询。缓解方式包括 RAG、工具验证、拒答、结构化约束、事实校验和线上监控。

## 架构演进
考查你是否理解模型为什么更大但推理更省。

### [MoE](${BASE}/llm/moe.html)
MoE 每个 token 只激活部分专家，在扩大总参数容量的同时控制单次计算量；难点是路由、负载均衡和专家并行。

### Dense vs MoE
Dense 简单稳定、吞吐可预测；MoE 容量大、激活参数少，但工程复杂度和路由不均衡风险更高。

## 评测与选型
最后一定要回到业务目标，而不是公开榜单。

### [能力评测](${BASE}/llm/evaluation_metrics.html)
公开 Benchmark 只能横向参考，业务需要自建覆盖正常、边界、对抗、长上下文和工具调用的测试集，并持续回归。

### [模型选型](${BASE}/llm/model_selection.html)
用合规、能力、延迟、成本、上下文、工具调用、部署方式和供应商稳定性建立选型矩阵；不要只说“哪个榜单分高”。

### Agent 岗优先级
如果面 Agent 开发，优先吃透采样参数、Prompt、CoT、幻觉、KV Cache、部署框架、评测和模型选型，它们会直接影响 Agent 质量和成本。
`,
  },
];
