# ADR-0118: 非用户 actor 的平台契约 —— null 表示、fail-closed、显式 `isSystem`

- **状态**: Accepted（2026-08-02，维护者按四轴框架裁决：平台长远合理性 / 防 AI 作者静默犯错 / 实际业务需求 / 创业阶段不扩边界）
- **日期**: 2026-08-02
- **关联**: ADR-0049（enforce-or-remove）、ADR-0078（no-silently-inert-metadata）、
  ADR-0092（better-auth 身份写守卫）、ADR-0103（`managedBy` 写策略与引擎写守卫）
- **执行项**: [#4556](https://github.com/objectstack-ai/objectstack/issues/4556)、
  [#2991](https://github.com/objectstack-ai/objectstack/issues/2991)、
  [#4560](https://github.com/objectstack-ai/objectstack/issues/4560)、
  [#3166](https://github.com/objectstack-ai/objectstack/issues/3166)
- **动因**: 四处现场各自发明「系统在操作」的表示法；不统一，每个新 PR 会继续各自发明，
  而统一它们要动审计数据迁移——越晚越贵

## 背景

### 同一个缺失概念的四个影子

平台里大量写入没有人类用户在场：启动同步、迁移、定时任务、生命周期扫描、流程自动化、
AI 工具的服务端调用。每到这种时刻，系统都要回答同一个问题：**这次操作的行为主体
（actor）是谁？** 现状是四处各答各的：

| 现场 | 当前答案 | 毛病 |
|---|---|---|
| `sys_metadata_history.recorded_by`（#4556） | `lookup('sys_user')` 列里存哨兵字符串 `'system'`（声明：`packages/metadata-core/src/objects/sys-metadata-history.object.ts#recorded_by`；写入：`packages/metadata-protocol/src/sys-metadata-repository.ts#recorded_by`） | 类型撒谎：声明是外键、存的不是 id，join 断；读侧被迫 `?? 'unknown'` 兜底（同文件、） |
| AI `ToolExecutionContext`（#2991） | 契约曾把「缺 actor」文档化为 system 级缺省 | fall-open：忘传上下文 = 拿到最高权限。契约文本已改为 fail-closed（`packages/spec/src/contracts/ai-service.ts#ToolExecutionContext`），执行器逐一验证仍未闭合 |
| SQL driver（#4560） | `current_user` 框架令牌被原样发射成列 DEFAULT | 框架层概念泄漏进存储层：数据库自己往 user lookup 列写非 id |
| 引擎 `isSystem`（#3166） | 特权内部写自愿声明 `isSystem`（如 `packages/objectql/src/lifecycle/lifecycle-service.ts#isSystem` 的 `SYSTEM_CTX`；#4441 写路径守卫的 isSystem 豁免） | 惯例成立但自愿：不声明也没人拦 |

### 为什么这是一个问题，不是四个

四个局部修法各自都能自洽（哨兵 / 缺省 / 令牌 / 标志），但它们硬化的是**四个略有出入的
「系统」概念**。放任各修各的，平台会同时存在「null 代表系统」「缺省代表系统」「字符串
`'system'` 代表系统」三种方言：

- 按类型编程的代码（含 AI 生成的解引用 / join）在方言边界上踩空；
- 在本仓工作的 AI 开发 agent 学到的是互相矛盾的模式，每个新调用点是一次掷骰子；
- 三种方言最终要统一时，动的是审计类数据的迁移——这类数据只增不改，越晚越贵。

这与 ADR-0049 / ADR-0078 点名的失效族同构：**表示法的静默分叉，比任何一种表示法本身
更坏。**

### 业界坐标，与本仓不能照抄的原因

Salesforce 用 Automated Process 伪用户行，ServiceNow 用 system 用户行。**本仓不能抄**，
有一个仓库特有的硬约束：`sys_user` 是 `managedBy: 'better-auth'` 的表
（`packages/spec/src/data/object.zod.ts#managedBy`，ADR-0092）——身份驱动拥有全部写路径，
密码哈希、令牌签发、邀请流都从它走。往里播种一行「永不登录的伪用户」等于绕过身份驱动
写身份表；且该账号从此要在用户列表、邀请流程、许可计数、权限选择器等**每一个**面被
排除，漏一处就是 bug——可被引用进权限授予时，是安全 bug。

## 决策

### D1 表示法：用户 lookup 列中，系统 actor = `null`；不造魔法账号，不存哨兵

所有指向 `sys_user` 的 actor 类列（`recorded_by`、审计 actor 列及后续新增）：

- 系统发起的写入存 **`null`**，列声明放宽为 optional/nullable，describe 明确
  「null = 系统发起（boot 同步 / 迁移 / 调度任务等）」；
- **禁止**哨兵字符串（`'system'`、`'unknown'` 等一切非 id 值）；
- **禁止**在身份表播种系统伪用户（理由见上节）；
- **显示是渲染规则，不是数据**：UI 对系统写入行的空 actor 渲染「系统」（走 i18n），
  不落库。

### D2 授权语义：缺席 ≠ 系统；缺 actor 一律 fail-closed

- 有 `actor` → 该用户的上下文（RLS 生效）；
- `isSystem: true` → 系统上下文（RLS 旁路），显式、可 grep 的提权；
- **两者皆无 → 匿名上下文（RLS 开、什么都看不见），永远不是 system。**

该语义已在 AI 工具边界落为契约文本（`packages/spec/src/contracts/ai-service.ts`，#2991 的契约面修复）。
本条把它升为**全平台规则**：任何执行路径——工具执行器、REST 处理器、任务运行器——
不得把「上下文缺失」解释为特权。「没有身份」永远不是授权。

### D3 系统上下文只在入口点显式构造，跨异步边界显式重建

- 合法入口点（穷举，新增须修订本 ADR）：boot/seed、迁移、任务调度器、生命周期扫描
  （`SYSTEM_CTX`）、流程引擎的内部推进。入口点构造 `isSystem: true` 一次，沿调用链
  传播；
- 跨异步边界（队列、定时器、重启恢复）时，接收侧是新的入口点，**显式重建**系统上下文，
  不隐式继承——这正是审批恢复类缺陷（#4420 一族）教的课；
- #3166 是本条的执行器：把「特权内部写必须显式声明 `isSystem`」从自愿惯例升为可检查
  契约（lint / 审计）。

### D4 框架令牌永不下沉到存储层

`current_user` 等框架令牌只在应用层解析为具体值（用户 id，或按 D1 为 `null`），
**不得进入**列 DEFAULT、生成 SQL 或任何持久化形态（#4560）。存储层看到的只有 id 和
null，永远没有令牌。

### D5 归因粒度：actor 二分；「哪个自动化」由关联字段回答

- actor 维度只有两类：某个用户 / 系统（`null`）。**不引入** `actor_kind` 枚举列；
- 追溯「是哪个自动化干的」用既有关联字段（flow run id、job 名、来源上下文），不在
  actor 上重复表达——那是双源（#4535 一族的教训）。

### D6 范围与非目标

**适用**：所有 actor 类审计列；`ToolExecutionContext` 与各执行器；驱动的 DDL/DEFAULT
生成；引擎写守卫的 `isSystem` 豁免路径。

**非目标**（按「不扩边界」轴明确排除）：

- `owner_id` —— 业务归属，归 `ownership` 轴管（ADR-0117）；系统不拥有业务记录；
- 多态 actor 引用（`actor_type` + `actor_id`）—— 表达力扩展，无业务需求不做；
- 为「区分多个非用户 actor」预留的任何结构 —— 见下方升级路径。

## 后果

- **破坏性**（已在 v17 `protocol:breaking` 清单内）：
  - #4556 —— 存量 `'system'` → `null` 迁移 + 列放宽（历史上该列只存过这一个哨兵，
    语义等价，changeset 写明）；
  - #2991 执行面 —— 依赖 fall-open 的调用方行为变化（本来就是漏洞形态）。
- **非破坏**：#4560 驱动修复；#3166 声明收紧；UI「系统」渲染规则。
- **升级路径**：将来若出现区分多个非用户 actor 的真实业务需求，以**新增归因字段**
  （加法）满足，不推翻 null 表示。

## 执行项

| Issue | 落什么 |
|---|---|
| #4556 | D1：`recorded_by` 可空 + 写路径存 null + 存量迁移 + describe |
| #2991 | D2：逐执行器验证 fail-closed 已按契约实现（契约文本已落） |
| #4560 | D4：驱动停止发射令牌 DEFAULT |
| #3166 | D3：`isSystem` 显式声明的可检查化 |
