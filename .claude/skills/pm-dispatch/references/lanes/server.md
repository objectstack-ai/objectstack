# 车道岗位说明:domain:server

见 seat-lifecycle.md;本文是本车道岗位说明,现值状态恒在座位贴,⛔ 不迁入本文。

- 三节按文件面分读:认领的 `File surface:` 落在哪节就读哪节,⛔ 不读整篇。
- 红线:触 `packages/spec` 的卡一律归 spec 席;改元数据格式或接受面的卡亦然,不论碰没碰 spec。

## 引擎面(原 `domain:engine`)

### 范围

- `packages/objectql`(含 SchemaRegistry)、`packages/core`、`packages/formula`
  (CEL、`matches-filter`、RLS 谓词求值)、`plugin-pinyin-search`(落点在编译与查询核心)。
- `objectql/src/metadata-facade.ts` 名字带 metadata,仍归本节。
- `packages/metadata*`(加载、注册、持久化、缓存、目录)、`packages/platform-objects`。
- `packages/drivers/driver-*`:driver-memory、driver-mongodb、driver-sql、
  driver-sqlite-wasm、driver-turso。
- `content/docs/**` 与 `packages/lint` ⇒ `domain:devx`;`packages/lint` 的唯一例外见 SKILL.md 锚定规则。

### 常设承诺

- driver conformance 台账只降不升:driver 卡的派发令要求 dev 前后各读一次 covered 与 DEBT。
- 放宽接受集或扩大公开面的卡按条款②处理,判据与档位在 SKILL.md,⛔ 不另抄。

### 席内判断

- 区域不等于文件:区域放行只能来自对方卡真实改动行程,有 PR 读 diff,没有就申报 UNKNOWN。
- 做删除的卡,其行程没人能从它加了什么的名字推出。
- 行号数小时内即腐烂,恒按符号定位。
- 五个 driver 列只有约三个独立实现:sqlite-wasm 与 turso local 都继承 `SqlDriver` 的 filter 编译器。
- ⇒ 把一致性表当五方佐证会高估证据;同理,单点修 SQL 家族共享 seam 即可覆盖三个 driver。
- 元数据合并语义按键类各不相同:fields 展开、validations 与 indexes 连接、标量 last-writer-wins。
- ⇒ 评审 pin 时先问它没有覆盖什么。
- 标量的 last-writer-wins 是重复立卡的老源头,同 seam 的第三张分歧卡优先裁类,不裁实例。
- 元数据接受面形状的卡先问生产者在哪:答案常改变卡的范围与域标签,回分诊。

## 服务插件面(原 `domain:services`)

### 范围

- `packages/services/*`、`packages/connectors/*`、`packages/triggers/*`、
  `plugin-approvals`、`plugin-webhooks`、`plugin-email`、`plugin-reports`、
  `embedder-openai`、`knowledge-*`。
- 身份侧:`plugin-auth`、`plugin-security`、`plugin-sharing`、`plugin-audit`。
- 安全与权限边界的放宽是人工地板,恒升级不代裁。
- 该边界含访问控制、认证流、RLS 与共享语义、审计留痕。

### 常设承诺

- 每条否定性 pin 都要消融验证:被禁行为放回、测试转红、报失败输出、恢复。
- 单独的绿不是证据。
- 安全族卡的披露纪律:复现配方不落任何公开面(卡、PR、评论)。
- 证据以抽象描述或私有通道承载。

### 席内判断

- 认证栈版本族升级把 `pnpm-workspace.yaml` overrides 与 `plugin-auth/**` 当同一个热文件面串行。
- 旧版本族上测得的前提(兼容性、行为断言)在新族落地后逐卡重读再派,⛔ 不沿用旧读数。
- 多服务共享同一条自动化引擎或数据源 seam 时,同文件卡跨轮硬串行。
- 后一单派发前先用前一单的报告重新定价,见 SKILL.md 候选与批次的重定价条款。

## CLI/运行时面(原 `domain:cli`)

### 范围

- `packages/cli`、`runtime`、`verify`、`types`、`packages/rest`、
  `packages/mcp`、`packages/observability`、`packages/client*`、
  `cloud-connection`、`create-objectstack`、`packages/adapters/*`、
  `plugin-hono-server`、`plugin-dev`;`packages/qa` 已归 `domain:devx`。
- 红线:按落点判归属 —— 标题挂 cli 而落点在别包的卡只上报误标,⛔ 不改签。
- `/meta` 路由本体归本节,元数据格式与接受面归 `domain:spec`。

### 常设承诺

- PR 侧绿不等于队列侧绿;队列分支条目名、队序重建与出队滞留住 `../platform-readings.md`。
- `dispatch-gates.mjs` 只报路径推导的地板;条款②从卡内容判,只定复核档不定施工档。
- 已知盲区:它不点名 `pnpm lint` 族 ⇒ 本车道派发令恒补一句跑 `pnpm lint`。
- ⛔ 永不削弱门禁:棘轮上跳是门禁在报你的改动有缺陷。
- 规则文案里自带的逃生舱只用于它描述的那种情形。

### 席内判断

- 探针的 baseline 也是测量,而且是没人复查的那个 ⇒ 判据恒读命中行本身,⛔ 不读命中数。
- 断言文本被删的探针要锚在消失的那段上:被删串的前缀在删除后仍幸存是构造使然。
- 静默时长是发探针的门槛,永不是判死的门槛;基线自本车道实录,⛔ 不写成常数。
- 分支无提交加 SendMessage 探针便宜,且能复活假死的 dev。
- ⛔ 永不往可能活着的 worktree 派第二个 agent。
