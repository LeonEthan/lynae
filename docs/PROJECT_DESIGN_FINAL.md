# PROJECT DESIGN: 桌面版 AI Coding 应用（Final）

更新时间：2026-02-24

## 1. 目标与范围

### 1.1 产品目标
- 构建一个桌面优先的 AI 编程工作台，体验接近 Cowork 类产品。
- 支持多轮对话驱动代码修改、终端执行、文件读写、Git 操作与任务审计。
- 支持在本地安全环境中完成从需求到代码落地的闭环。

### 1.2 运行时策略（本期确定）
- 本期仅接入 `Claude Agent SDK`（`@anthropic-ai/claude-agent-sdk`，统一使用 Claude Runtime）。
- 暂不接入 Codex 或其他 Runtime Provider。
- 上层保留 Runtime 抽象接口，但采用“薄适配层”策略，避免重复实现 Agent Runtime 核心能力。

### 1.3 MVP 边界（第一阶段）
- 单用户本地桌面版（macOS/Windows，Linux 后置）。
- 本地仓库操作 + GitHub 登录（可选）+ PR 辅助。
- 具备最小可用安全能力：权限审批、工具白名单、命令审计、密钥隔离。

### 1.4 非目标（MVP 不做）
- 企业多租户权限系统（RBAC/SSO/SCIM）。
- 云端任务调度平台与分布式中台。
- IM 远程控制、视频生成、团队协作等重功能模块。

## 2. 参考项目合并结论

### 2.1 OpenCowork 可复用点
- 前端工作台交互模型：会话、工具调用、文件与任务视图联动。
- 工具调用前的人类确认机制（Human-in-the-loop）。
- 工程流能力：分支、checkpoint、回滚、PR 工作流。

### 2.2 LobsterAI 可复用点
- 模块化拆分思路：前端、Agent Core、工具层、存储层解耦。
- Skills 体系化管理（内置技能 + 后续可扩展插件）。
- 安全与审计优先：关键操作可追踪、可复盘。

### 2.3 本项目取舍
- 采纳成熟模式，不复制其复杂平台化后端。
- 优先本地单体架构，先做稳、再做大。

## 3. 产品方案（MVP）

### 3.1 核心体验
- Workspace 会话：每个会话绑定一个本地仓库目录。
- Plan/Execute 双态：
- Plan：先产出执行计划与变更预览。
- Execute：授权后自动改文件/跑命令/执行 Git 操作。
- 可追溯执行流：工具调用、命令输出、文件 diff 全链路回放。
- 可中断可恢复：长任务支持取消、恢复、重试。

### 3.2 功能清单（按优先级）

#### P0（MVP 必做）
- Chat + 任务编排（流式输出）。
- 文件系统工具（读写/搜索/批量修改）。
- 终端工具（命令执行、超时控制、资源限制）。
- Git 工具（status/diff/branch/commit/push/PR 草稿）。
- 权限审批中心（命令级、文件级、网络级）。
- 会话与审计（SQLite 本地持久化）。

#### P1（MVP 后）
- MCP 集成（如浏览器、Notion、GitHub 工具）。
- 浏览器自动化（Playwright）。
- 定时任务（Cron + 队列）。

## 4. 技术架构

### 4.1 总体架构（桌面优先）
- 桌面壳层：`Electron`（优先）。
- 前端：`React + TypeScript + Vite`。
- Agent Core：Node.js/TypeScript（任务状态机、会话编排、工具调度）。
- Runtime Adapter：`claude-adapter`（薄适配层，封装 Claude Agent SDK）。
- Tool Runner：shell/file/git/browser 等工具统一执行层。
- 数据层：`SQLite + Drizzle ORM`（会话、审计、配置）。

### 4.2 分层结构
- `apps/desktop`：UI + IPC。
- `packages/agent-core`：Planner、执行状态机、事件总线。
- `packages/runtime-adapters/claude`：Claude Agent SDK 薄适配层（事件映射/错误归一化）。
- `packages/toolkit`：工具统一接口、审批守卫、超时/重试。
- `packages/policy-engine`：权限规则、风险分级、审批策略。
- `packages/storage`：Schema、迁移、审计查询。

### 4.3 Runtime 抽象接口（保留扩展能力）
```ts
interface AgentRuntime {
  name: "claude";
  createSession(input: SessionInput): Promise<SessionRef>;
  runTurn(input: TurnInput): AsyncIterable<RuntimeEvent>;
  cancel(sessionId: string): Promise<void>;
  listCapabilities(): RuntimeCapabilities;
}
```

设计要点：
- 上层统一消费 `RuntimeEvent`（文本、工具调用、diff、日志、错误）。
- Provider 差异封装在 `claude-adapter` 内部。
- `claude-adapter` 仅负责 SDK 启动、事件映射、错误归一化，不承载复杂业务编排。
- 禁止在 UI 或业务层直接调用 `@anthropic-ai/claude-agent-sdk` 或 `@anthropic-ai/sdk`。

### 4.4 SDK 选型约束（纠偏）
- 运行时编排（会话、turn、工具调用、流式事件）统一使用 `@anthropic-ai/claude-agent-sdk`。
- `@anthropic-ai/sdk` 是底层模型 API 客户端，不作为本项目 Agent Runtime 实现。
- MVP 的 Runtime 路径禁止引入 `@anthropic-ai/sdk`，避免把“LLM 调用层”误用为“Agent 执行层”。

### 4.5 职责边界（避免过度与重复设计）
- 由 Agent SDK 负责：Agent loop、会话上下文管理、工具调用循环、流式协议细节。
- 由本项目负责：Plan/Execute 状态机、审批流、策略引擎、审计落库、工作区安全边界。
- 不在 `claude-adapter` 重复实现：对话历史管理器、手写 tool loop、底层流事件拼装解析器。
- 如需 Provider 扩展，仅新增同等“薄适配层”，禁止复制一套新的 Runtime 内核。

## 5. 安全与风控（必须）

### 5.1 默认最小权限
- 文件写入限制在 workspace 根目录内。
- 命令执行默认 deny，按 allowlist + 审批放行。
- 网络默认关闭，仅对白名单域名放行。

### 5.2 高危操作二次确认
- `rm -rf`、批量删除/改写。
- `git push --force`、危险分支操作。
- 下载并执行外部脚本。

### 5.3 密钥与审计
- API Key 使用 OS Keychain（macOS Keychain / Windows Credential Manager）。
- 审计记录最小闭环：调用人、时间、参数摘要、结果、diff 摘要。
- 对外部网页/第三方内容标注不可信来源，防止 Prompt Injection 提权。

## 6. 数据模型（精简版）

### 6.1 核心实体
- `sessions`：会话元信息（状态、工作目录、模型）。
- `messages`：用户/助手/工具消息。
- `tool_executions`：工具调用与审批结果。
- `approvals`：审批记录（谁批准、何时批准、作用范围）。
- `settings`：本地应用配置。

### 6.2 存储原则
- 本地优先存储。
- Schema 可迁移（版本化 migration）。
- 审计与业务数据分表，避免查询耦合。

## 7. 里程碑（12 周）

### Phase 0（第 1-2 周）：架构打底
- Monorepo 初始化、Electron 壳层、基础会话 UI。
- IPC 通道与事件模型打通。
- SQLite/Drizzle 初始化与首版 schema。

### Phase 1（第 3-5 周）：MVP 核心闭环
- 接入 `Claude Adapter`。
- 文件/终端/Git 工具链 + 审批流。
- checkpoint 与回滚。
- 首版审计日志与基础指标。

### Phase 2（第 6-8 周）：稳定性强化
- 长任务恢复、错误重试、超时治理。
- 策略引擎完善（命令、路径、网络三级规则）。
- E2E 测试覆盖关键路径（对话->改码->验证->提交）。

### Phase 3（第 9-12 周）：Beta 发布能力
- PR 辅助流程完善（草稿说明、风险提示）。
- 安装包发布、自动更新、崩溃监控。
- 文档完善与 Beta 反馈闭环。

## 8. 风险与对策
- Claude Agent SDK 行为变更：通过适配层隔离 + 契约测试兜底。
- 适配层变厚导致维护成本上升：保持“薄适配”边界，新增逻辑优先放在 `agent-core/policy/toolkit`。
- 权限策略过松：默认 deny + 高危动作强制确认。
- 桌面环境差异（OS/终端）：增加环境探测与预检报告。
- 成本与时延波动：token/时长预算、任务硬超时、并发上限。

## 9. 推荐技术栈（MVP）
- 桌面：Electron + React + TypeScript + Vite。
- Runtime：Claude Agent SDK（`@anthropic-ai/claude-agent-sdk`，唯一 Provider）。
- 数据：SQLite（better-sqlite3）+ Drizzle ORM。
- 执行：node-pty（终端工具）、Playwright（后续 P1）。
- 观测：OpenTelemetry（可选接 Langfuse）。
- 发布：GitHub Actions + Electron Builder。

## 10. 验收指标（MVP）
- 任务成功率：>= 70%（3 次迭代内完成目标修改并可运行）。
- 单次任务恢复成功率：>= 90%。
- 高危命令误执行：0。
- 首次可用代码产出 P50：<= 3 分钟。
- Beta 阶段严重崩溃率：持续下降并可定位根因。

## 11. 结论
- 本版最终方案采用“Claude Agent SDK 单 Runtime + 本地优先 + 安全先行”的策略。
- 目标是在 12 周内交付可用 Beta，并验证核心闭环与安全基线。
- Codex 及其他 Runtime 在本期明确不纳入范围，后续按业务验证结果再评估。
