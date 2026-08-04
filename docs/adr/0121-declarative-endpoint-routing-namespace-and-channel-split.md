# ADR-0121: 声明式端点的路由归属与通道分工 —— 命名空间制、actions/apis 按调用方分工、`type: flow` 保留

- **状态**: Accepted（2026-08-04，维护者裁决；本记录只立规则，执行体由 #5040 的 E 系列实施）
- **日期**: 2026-08-04
- **关联**: [ADR-0076](./0076-objectql-core-tiering.md)（D11 —— 一条路由一个属主；本 ADR **扩充**它，不取代）、
  [ADR-0049](./0049-no-unenforced-security-properties.md)（enforce-or-remove，本 ADR 落在它的时序上）、
  [ADR-0066](./0066-unified-authorization-model.md)（D4 action 双面权限门）、
  [ADR-0104](./0104-field-runtime-value-shape-contract.md)（action 参数契约）、
  [ADR-0078](./0078-no-silently-inert-metadata.md)（不留静默失效的元数据）、
  [ADR-0028](./0028-metadata-naming-and-namespace-isolation.md)（namespace 作为寻址维度；状态 Deferred，本 ADR 只在端点这一面局部兑现其 §3，不解冻整体）
- **执行项**: [#4936](https://github.com/objectstack-ai/objectstack/issues/4936)（v17 响亮拒绝，在飞）、
  [#4939](https://github.com/objectstack-ai/objectstack/issues/4939)（`ApiRegistry` 同批退役）、
  [#5040](https://github.com/objectstack-ai/objectstack/issues/5040)（17.x 执行器立项；E7 翻转 PR 落本 ADR 的 publish 门）
- **动因**: v17 的响亮拒绝已把声明式端点整面清场，17.x 重建执行器**之前**必须先回答两个问题 ——
  「谁有资格认领哪片路由」和「actions 与 apis 各自管什么」。两问不落档，执行器建成之日就是
  撞路径与通道混淆开始积累之时；而那时再收紧要付真实迁移代价，今天收紧代价为零。

---

## TL;DR

| # | 决定 | 一句话 |
|---|---|---|
| D1 | 端点只能认领本应用的命名空间 | 路径收紧为 `<运行前缀>/apps/<命名空间>/<子路径>`，publish 期强制 |
| D2 | 命名空间段派生，不是作者自由字段 | 派生自 stack 身份（`manifest.namespace`），作者只自由命名子路径 |
| D3 | 通道按**调用方在哪**分工 | 调用方在平台内 → `actions`；调用方在平台外 → `apis` |
| D4 | `type: flow` 保留在 `ApiEndpoint` | 「URL 触发 flow」是入站集成第一原语，摘除即逆北极星 |
| D5 | 同管线红线 | flow 端点纯委派 automation 服务，与 action 触发零语义分叉 |
| D6 | 匿名端点必须自带限流 | `authRequired: false` 未声明 `rateLimit` → publish 拒绝并附处方 |
| D7 | 范围与非目标 | 本 ADR 不写实现细节；签名验证等明示为将来词表候选，不预支 |

贯穿全文的两条评估轴（与 #5040 设计文档同轴，维护者裁决即按此二轴做出）：**项目长远合理性**
（契约优先、无变通、可持续），与**防 AI 写元数据犯错**（写错在最早的关口被响亮打回，不存在
「解析通过然后什么也不发生」的中间态）。

---

## 背景

### 一、清场已经发生，所以现在改路由形状不花钱

#4936 用真实 boot（不是 grep 推断）证明声明式端点全链路零执行：showcase 声明的两个端点
经 `defineStack({ apis })` 装进元数据、`GET /api/v1/meta/api` 如实返回，而同一 boot 同一
cookie 下两条路径都是 HTTP 404 —— 两处断链各自足以致死：路径从未挂载（dispatcher-plugin
逐条显式注册，声明路径没有任何 catch-all），以及匹配器不存在（`matchEndpoint` 全仓无实现，
`handleApiEndpoint` 恒 `{ handled: false }`）。

维护者 2026-08-04 00:20Z 对此裁决「改良后的第三路」：**v17 内 publish/validate 对非空
`apis:` 硬拒**（带处方），17.x 内建设执行器，建成后把拒绝换成执行，词表零折腾；#4939 的
`ApiRegistry` 无条件同批退役，两套端点声明形状收敛为一套。

这条时序给出了一个不会再有第二次的窗口：**硬拒之后，没有任何存量栈能带着非空 `apis:`
活到 17.x**。此刻收紧路径形状的迁移成本严格为零 —— 没有既有 URL 要改，没有既有集成方
要通知。等执行器建成、端点开始承载真实第三方集成，同一条收紧就变成对外契约的破坏性变更。
**这是 ADR-0049「enforce-or-remove」时序的直接推论**：先响亮拒绝清场（#4936），再在空场上
立规则（本 ADR），最后一次性接通执行（#5040 E7）。

### 二、ADR-0076 回答了「一条路由归谁」，没回答「谁有资格认领哪片路由」

ADR-0076 D11 把传输层收成「薄 dispatcher + 各域注册规范化 handler」，其 OQ#9 工作项逐条
消灭了 first-registration-wins 的双属主（`/discovery`、`/packages` 各归单一确定属主）。
那条决定管的是**已有的一组内建路由之间**的归属。

它管不到的是**元数据能认领什么**。`ApiEndpointSchema.path`（`packages/spec/src/api/endpoint.zod.ts`）
今天的全部约束是：

```ts
path: z.string().regex(/^\//).describe('URL Path (e.g. /api/v1/customers)'),
```

只要求以斜杠开头。一条应用元数据因此可以合法声明 `/api/v1/data/anything`、`/api/v1/meta/x`、
`/api/v1/actions/y` —— 与内建域正面相撞；也可以与另一个已安装应用撞在同一 `method + path` 上。
#4939 把这个形状说破了：「仓里有两套端点声明形状……两套都零执行 —— **这本身就是 ADR-0076
「一条路由一个属主」要防的形状，只不过这里两个属主都没上岗**」。

代价是可见的：#5040 设计 §1 为了在自由路径下守住 0076，不得不发明一整套补偿机制 ——
一份枚举全部内建前缀的**保留前缀族**（domain registry 全部前缀 ∪ `LEGACY_CHAIN_PREFIXES`
∪ REST 专属族 ∪ scoping 前缀），一份 pin 在 spec 侧的常量副本（spec 侧 build 门无法 import
runtime），外加一个「pin 列表 ⊇ 实际 registry 前缀 ∪ ledger」的双端一致性测试防漂移。
**这套机制本身就是变通的形状**：每新增一个内建域，都要记得回来更新 pin 列表，忘了就是一次
静默的归属冲突；而它防住的只是「撞内建」，跨应用互撞仍要靠 publish 期的另一条去重规则。

### 三、主流平台零例外：应用元数据从不认领任意路由

维护者裁决前做过横向调研，结论是没有一家例外：

| 平台 | 应用/自定义端点的路由形状 | 应用段来源 |
|---|---|---|
| Salesforce Apex REST | `/services/apexrest/<ns>/…` | 组织/包 namespace |
| ServiceNow Scripted REST | `/api/<scope>/<api_id>/…` | 应用 scope |
| MS Dataverse Custom API | 纯名字派生，作者不写路径 | 解决方案发布者前缀 |
| Shopify App Proxy | `/apps/<子路径>` | 平台保留的 `apps` 切出段 |
| Kubernetes CRD | `/apis/<group>/<version>/<kind>` | group/version/kind 派生 |

共同结构：**平台切出一段自己保留的前缀，在其下按声明方身份再切一段，作者只在最里层自由
命名**。这不是巧合 —— 它是「一条路由一个属主」在多租户、多安装包世界里唯一能靠构造（而不是
靠约定加检查）成立的形式。

### 四、两个通道的成熟度不对称，分工判据必须写下来

`actions` 通道（`POST /actions/:object/:action`，`packages/runtime/src/domains/actions.ts`）
已经是成熟的命令通道：ADR-0104 的参数契约、ADR-0066 D4 的双面权限门、#3962 完成的
HTTP 语义化错误统一（「失败说 HTTP」：404/403/400/503 分层，拒绝 400、崩溃 500，不再有
200 套 `{success:false}` 的内层信封）、#3915 的按声明类型分派（`script` 走 handler 注册表、
`flow` 走 automation 服务），以及 `ActionAiSchema`（`packages/spec/src/ui/action.zod.ts`）
的 AI/MCP 暴露门。

但平台**外**调用方有三个 actions 结构上不满足的硬特征：

1. **报文形状对方定** —— 第三方 webhook 的 body 是对方系统的形状，需要 `inputMapping`
   做防腐层；actions 的入参是本平台定义的 `params` 契约（ADR-0104），没有这一层。
2. **无平台会话** —— 需要 `authRequired: false` 配端点级 `rateLimit`；actions 是 POST-only
   且预设调用方已过认证门。
3. **URL 是写进对方系统的对外契约** —— 需要稳定路径 + OpenAPI 描述；actions 的 URL 形状由
   `:object/:action` 派生，不是可自由稳定命名的对外地址。

行业同构印证了这条分界：Salesforce 有内部 Invocable Actions 与对外 Apex REST 两套；
ServiceNow 有内部 UI Action 与对外 Scripted REST 两套。**两个通道不是冗余，是两类调用方。**
但只要判据不写下来，AI 作者（和人）就会按「哪个先搜到」二选一，两侧慢慢长成互相的方言。

---

## 决定

### D1 — 声明式端点只能认领本应用命名空间下的路由

`ApiEndpointSchema.path` 的合法形状收紧为：

```
<运行前缀>/apps/<命名空间>/<子路径>
```

- `<运行前缀>` 是部署的 dispatcher 前缀（默认 `/api/v1`）；
- **`apps` 是平台为此保留的唯一切出段**。它今天不是任何内建域的前缀 —— domain registry
  的前缀集（`/health` `/ready` `/data` `/meta` `/actions` `/mcp` `/ai` `/auth` `/analytics`
  `/i18n` `/notifications` `/security` `/keys` `/ui` `/share-links` `/packages` `/automation`）
  与 `LEGACY_CHAIN_PREFIXES`（`packages/runtime/src/route-ledger.ts`）中均无 `/apps`，
  切出即生效，不与任何在用路由冲突；
- `<命名空间>` 按 D2 派生，作者不自由填写；
- `<子路径>` 是作者唯一自由命名的部分。

**publish 期强制**：不符合此形状的 `path` 在 `defineStack` / `os validate` / publish 被
拒绝，拒绝信息带处方（给出该 stack 应当使用的确切前缀）。这是 declared = enforced 的落法 ——
不合规的声明不会「解析通过然后永远匹配不上」。

**对 ADR-0076 的回答**：0076 D11 答「一条已有路由归谁」，本 D1 答「谁有资格认领哪片路由」。
两条合起来，路由归属在**构造上**成立而不再靠清单维护：

- 端点撞内建域：**不可能** —— 内建域没有一个在 `apps/` 下；
- 跨应用端点互撞：**不可能** —— 两个应用的命名空间段不同（`manifest.namespace` 的契约即
  「Must be unique within a running instance」）；
- 同应用内互撞（同 `method + path` 两条声明）：仍需 publish 期去重，这是 D1 之后**唯一**
  剩下的撞路径形态，且完全落在单个 stack 的作者视野内。

**因此 #5040 设计 §1 的保留前缀 pin 清单、spec/runtime 双端一致性测试整体作废**，其 §7-8
（部署前缀与声明脱钩）大幅收窄。少掉的不是工作量，是一类**会随平台演进而静默腐坏的耦合**。

### D2 — 命名空间段派生自 stack 身份，作者不填写

声明单位是 **stack/package，不是某个 app 条目** —— 这一点仓内已有定论，不是本 ADR 新立的：
`apis:` 是 `ObjectStackDefinitionSchema` 的顶层键（`packages/spec/src/stack.zod.ts`），而
`App.apis` 已于 `@objectstack/spec` 17.0.0 退役并留下墓碑（`packages/spec/src/ui/app.zod.ts`）：

> `App.apis` was removed in @objectstack/spec 17.0.0 (2026-06 liveness audit — never read).
> Declarative endpoints belong to the stack (`defineStack({ apis })`), not the app shell.

所以 `<命名空间>` 取 stack 身份。**规范来源为 `manifest.namespace`**
（`packages/spec/src/kernel/manifest.zod.ts`）—— 它是 stack 上唯一同时满足三条的身份键：

1. **URL 安全**（字符集 `^[a-z][a-z0-9_]{1,19}$`，2–20 字符），无需任何转义或编码规整；
2. **带唯一性语义**（其字段文档注释的 Rules 明写「Must be unique within a running
   instance」，并保留 `base` / `system` / `sys` 三个平台命名空间）；
3. **已经是被强制执行的身份**（每个 `object.name` 必须是 `${namespace}_${shortName}`，
   由 `validateObjectNamespacePrefix` 在 `defineStack()` 与 `MetadataManager.publishPackage()`
   两处执行 —— 见 `packages/spec/src/kernel/namespace-prefix.ts`）。

对照被排除的两个候选：`manifest.id` 虽然必填，但是反向域名且 schema 上无任何字符集约束
（`z.string()`），不 URL 安全；而平台已有 `deriveNamespaceFromPackageId`（同文件）把 id
的末段折成合法 namespace，说明「id → namespace」本就是既有的规范化方向，不需要在 URL 面
再造第二条。

**取值式**：`manifest.namespace`，缺省时回落 `deriveNamespaceFromPackageId(manifest.id)`；
两者皆无法得出合法 namespace → publish 拒绝并附处方（「声明 `apis:` 的 stack 必须有
`manifest.namespace`」）。回落是否应当保留，见下方开放问题 Q1。

这条派生带来两个白拿的好处：**URL 自带应用名可反查**（`/api/v1/apps/showcase/tasks` 与
对象名 `showcase_task` 同源同段），以及**AI 需要掌握的平台内部知识归零** —— 作者不需要知道
任何保留前缀清单，只需要知道「我的子路径写在自己名下」。showcase 的两个自证端点在此规则下
从 `/api/v1/showcase/tasks`、`/api/v1/showcase/inquiries/purge` 变为
`/api/v1/apps/showcase/tasks`、`/api/v1/apps/showcase/inquiries/purge`（随 #5040 E8 回迁）。

### D3 — 通道分工：actions = 平台内命令，apis = 平台外集成面

**判据（一句话，两侧 schema describe 与文档一字不改地复述）：**

> **调用方在平台内（有会话、懂平台方言：UI 按钮、AI/MCP、SDK）→ `actions`；
> 调用方在平台外（第三方 webhook、合作方系统）→ `apis`（资源读写 + webhook 接收）。**

判据的维度是**调用方在哪**，不是「做什么」—— 后者会立刻退化成口味之争（「删记录算命令还是
资源操作？」），前者对任何一个具体端点都有唯一答案。依据见背景 §四：actions 已具备命令通道
的全部成熟件，而平台外调用方的三个硬特征（报文形状对方定 / 无平台会话 / URL 是对外契约）
actions 结构上均不满足。

**执行项归属**：把这句判据写进 `ApiEndpointSchema` 与 `ActionType`
（`packages/spec/src/ui/action.zod.ts`）两侧的 `describe()` —— 因为 describe 会进生成的
JSON Schema，那是 AI 作者实际读到的那份文案。**describe 的修改属 spec 车道执行项，本 ADR
只立规则、不改任何 `.zod.ts`。**

### D4 — `type: flow` 保留在 `ApiEndpoint`

「URL 触发 flow」是入站集成的第一原语 —— Zapier / Make / n8n 的 webhook trigger 就是这个
形状；showcase 的自证案例 `POST …/inquiries/purge` 本身就是一个 `type: 'flow'` 端点。
把它从 `ApiEndpointSchema.type` 摘掉，等于宣布**第三方 webhook 接收没有元数据故事，
只剩代码逃生舱** —— 这与北极星（业务系统压缩进 AI 可持有的类型化元数据）正面相反。

保留。它与 `Action` 的 `type: 'flow'` 之间确有一条重叠带，重叠带用 D3 的判据划线、用 D5
的红线兜底 —— 而不是靠删掉一侧来消除。

### D5 — 同管线红线：flow 端点零语义分叉

`type: 'flow'` 的端点**纯委派** automation 服务，与 action 触发走同一条 `execute` +
身份信封转发管线（#5040 设计 §4 已立此实现口径：复用 `buildAutomationContext`，
`runAs: 'user'` fail-closed，RLS 按触发者）。**不得**为端点另造一条 flow 执行路径。

这条红线是 D4 得以安全保留的前提：它保证**选错通道只是风格问题，不是行为问题**。一个作者
把本该走 actions 的操作写成了 apis 端点，得到的是同一次 flow 执行、同一套身份与 RLS 语义、
同一种错误包络 —— 代价止于 URL 形状与策略键，不会渗进执行语义。反过来说，一旦允许两条管线，
D3 的判据就从「风格指引」升级成「踩错即 bug 的陷阱」，那正是本平台反复付过学费的
declared ≠ delivered 形状。

### D6 — 匿名端点必须自带限流（防呆门）

`authRequired: false` 的端点**必须**同时声明 `rateLimit`，否则 publish 拒绝并附处方。

理由是这个组合的失效方式：一个匿名可达且无配额的端点，作者写下时看到的是「解析通过」，
而它实际上是一个免费的、可被任意第三方打的执行入口。`authRequired` 的默认值是 `true`
（`endpoint.zod.ts`），把它显式改成 `false` 是唯一的开门动作，**开门就必须同时装配额**是
最小的、在作者视野内可满足的对偶要求。这是防 AI 犯错轴上最直接的一条：AI 生成
`authRequired: false`（因为「webhook 嘛」）而忘记 `rateLimit` 是可预期的高频错误，
把它变成 publish 期的响亮拒绝，比任何文档都可靠。

**签名验证**（webhook 真实需要 —— HMAC / 时间戳 / 重放窗口）明示为**将来的词表候选**，
本 ADR **不承诺**：`ApiEndpointSchema` 今天没有这组键，凭空补一组无执行器消费的键，
正是 ADR-0078 禁止的静默失效元数据。需要时单独立卡、连同执行器一起进。

### D7 — 范围与非目标

**本 ADR 管**：声明式端点的路径归属规则（D1/D2）、两个通道的分工判据（D3）、
`type: flow` 的存废与其纪律（D4/D5/D6）。

**本 ADR 不管**（留在 #5040 设计文档，实现期决定）：`matchEndpoint` 的签名与索引策略、
挂载 seam 的选型（兜底 handler vs 通配路由）、`cacheTtl` 的键形状与存储、`inputMapping`
的求值细节、路径模板语法。这些是实现选择，写进 ADR 只会让 ADR 随实现腐坏。

**明确的非目标**：
- 不解冻 ADR-0028 整体（那是平台级迁移，状态仍是 Deferred）。本 ADR 只在声明式端点这
  一面兑现其 §3「namespace 是每个传输面的寻址段」，且形状不同（`apps/<ns>/…` 而非
  ADR-0028 设想的裸 `<ns>` 段）—— 端点面本来就在清场状态，是唯一能零成本兑现的一面；
- 不改内建路由的形状。`/data`、`/actions` 等一律不动；
- 不为端点引入签名验证、路径模板、scoped URL 变体等新词表（D6 与 #5040 §7 已分别登记）。

---

## 替代方案

两条固定评估轴：**长远合理性**（项目长期健康、契约优先、无变通）与
**防 AI 写元数据犯错**（结构上在作者时刻拦住，而不是靠消费端宽容）。

### O1 — 自由路径 + 保留前缀门（#5040 设计 §1 的原方案）

保留 `path` 的任意性，靠 publish 期一份枚举全部内建前缀的保留族拦截冲突。

- **长远合理性：不合格。** 这是教科书式的「消费端补偿」：真正的问题在生产端（元数据可以
  声明它无权声明的东西），却用一份必须手工维护的清单去追。清单与实际路由表是两处真相 ——
  #5040 自己也承认这一点，所以设计里配了一个双端一致性测试来防漂移。**需要一个测试来防止
  腐坏的机制，本身就是腐坏的机制**；每新增一个内建域都要记得回来更新 pin 列表，忘一次就是
  一次静默的归属冲突。而且它只防「撞内建」，跨应用互撞要另立规则。
- **防 AI 犯错：不合格。** 作者（尤其 AI）必须掌握一份**平台内部知识**才能写对路径 ——
  「哪些前缀被内建占了」是实现细节，今天 17 个明天 18 个。最常见的 AI 错误正是把端点声明
  在 `/api/v1/data/...` 下然后困惑于行为不对；O1 能在 publish 拦住它，但拦住的是一个
  **本不该有机会出现**的错误。
- **判定：否决。** 它把一个可以在构造上消失的问题，变成了一个需要永久维护的门禁。

### O3 — actions 全面替代 / Dataverse 模式（摘除 `apis:` 或摘除 `type: flow`）

只保留 `actions` 一个执行通道，声明式端点整面退役（或至少摘掉 `type: flow`），
第三方集成一律走 actions 或代码挂载端点。

- **长远合理性：不合格，且与已有裁决冲突。** #4936 的裁决依据已经点明：「端点词表是行业
  极稳定形状，退役再重引入必然引回同一套 —— 退役收益只剩杀谎，而响亮拒绝同样杀谎且保留
  词表与元数据投资」。更要害的是背景 §四那三个硬特征：actions 结构上不满足平台外调用方的
  需求（`inputMapping` 防腐、匿名 + 端点级配额、稳定对外 URL + OpenAPI）。硬要 actions
  兼任，等于把这三样逐个塞进 actions 词表 —— 最终得到的是同一套 apis 词表，只是长在了
  一个为平台内调用方设计的通道上，两类调用方的策略从此纠缠。
- **防 AI 犯错：不合格。** 摘除 `type: flow` 的直接后果是「第三方 webhook 接收没有元数据
  故事，只剩代码逃生舱」。逃生舱恰恰是 AI 最不该被推去的地方：一段手写 handler 不受任何
  publish 门约束，`authRequired` / `rateLimit` / 权限全靠人记得写。**把一类真实需求赶出
  元数据面，不会让它消失，只会让它以不受治理的形态出现。**
- **判定：否决。** Dataverse 的纯名字派生模式在**路径派生**这一点上是对的（本 ADR 的 D2
  正是吸收了它），但它的「只有一个通道」不适用于本平台 —— Salesforce / ServiceNow 这两个
  形态更接近的平台都是双通道，而它们比 Dataverse 更早遇到「合作方系统直接打进来」的需求。

### O2 — 命名空间制（采纳）

- **长远合理性：最优。** 归属靠构造保证，不靠清单维护：内建域与应用域在 URL 空间上物理
  分离，跨应用互撞被 namespace 的唯一性契约排除。平台新增内建域不需要通知任何人，
  应用新增端点不需要知道平台有哪些域 —— 两侧解耦。这是 ADR-0076「一条路由一个属主」
  从「靠约定 + 一致性测试」升级为「靠构造」的唯一路径。主流平台零例外这一点，是它长期
  可行的独立佐证。
- **防 AI 犯错：最优。** AI 需要掌握的平台内部知识**归零** —— 唯一要知道的规则是
  「写在自己名下」，而那个名字它已经在每个对象名里写过一遍。写错的形态从「撞了一个我不知道
  存在的内建前缀」变成「前缀写错了」，后者的 publish 拒绝信息可以直接给出正确的完整前缀，
  一次修好。URL 自带应用名还让运行期反查免费：看到一条 `/api/v1/apps/showcase/...`
  就知道该找谁。
- **成本，如实计**：见下方「后果」。

---

## 后果

**收益**

- 跨应用撞路径、端点撞内建域两整类问题在构造上消失；ADR-0076 的「一条路由一个属主」
  在元数据面首次成为构造性保证而非约定；
- #5040 设计 §1 的保留前缀 pin 清单与 spec/runtime 双端一致性测试整体作废（E1/E3 面缩小），
  §7-8「部署前缀与声明脱钩」大幅收窄 —— 少掉的是会随平台演进静默腐坏的耦合；
- 两个通道各自的定位写进 describe（进生成 JSON Schema），AI 作者第一次能从词表本身读到
  「我该用哪个」，而不是靠猜；
- 匿名 + 无配额这一具体高危组合从「解析通过」变成 publish 拒绝。

**代价，如实说**

- **URL 变长且不再由作者完全掌控**。`/api/v1/apps/showcase/tasks` 比 `/api/v1/showcase/tasks`
  多一段，且应用段随 `manifest.namespace` 走 —— 改 namespace 会改所有端点 URL。这是刻意的
  取舍（URL 的稳定性因此绑定到一个平台已在强制唯一的身份上，而不是绑定到作者的自由输入），
  但对「我要一个短好看的对外地址」的诉求是明确的拒绝。自定义域名/网关侧改写不在本 ADR 范围。
- **本 ADR 不减少 #5040 的执行器工作量**，只减少其中防御性的一部分。挂载、匹配、逐键接线
  仍是 E2–E6 的全部工作。
- **判据（D3）是分工指引，不是可执行的门**。publish 无法判断「这个端点的调用方在平台内
  还是平台外」—— 那是作者的意图。能执行的只有 D6 这类结构性对偶要求。D5 的同管线红线是
  这条代价的兜底：判据判错不产生行为差异，所以它可以只是指引。
- **`apps` 段一旦切出即终身保留**。平台从此不能把 `/api/v1/apps` 用作内建域。这是切出段的
  定义性成本，已核实今天无冲突。

**破坏性**：**无**。v17 已对非空 `apis:` 硬拒（#4936），17.x 收紧时不存在受影响的存量声明。
showcase 的两个示例端点随 #5040 E8 按新形状回迁。这正是背景 §一所说的零成本窗口 ——
本 ADR 的全部破坏性预算都由 #4936 在 v17 窗口内预先支付了。

---

## 开放问题（留给 #5040 E7 实现期确认，不阻塞本 ADR 的接受）

1. **Q1 — 命名空间回落是否保留。** D2 取 `manifest.namespace`，缺省时回落
   `deriveNamespaceFromPackageId(manifest.id)`。回落让不写 namespace 的 stack 也能声明端点；
   硬性要求显式 `manifest.namespace` 则让 URL 的来源永远是作者亲手写下的一个字段（对外
   契约不因 id 改写而漂移）。两者都自洽；起草倾向**硬性要求**（对外 URL 不应有派生来源的
   歧义），但回落成本更低，交 E7 定夺并写进拒绝文案。
2. **Q2 — 子路径的字符集与规整。** D1 未约束 `<子路径>` 的字符集（百分号编码、大小写、
   Unicode 规整）。#5040 §7-5 已把匹配的字符层语义登记为未决；publish 门是否同时约束声明
   面的字符集，随该项一并决定。
3. **Q3 — 平台保留段的复数形态。** 本 ADR 只切出 `apps` 一段。若将来需要区分「应用端点」
   与「平台级集成端点」，是在 `apps` 下再分层还是切第二段保留字，届时由新 ADR 决定 ——
   本 ADR 不预留结构。

---

## 执行项

| Issue | 落什么 | 车道 |
|---|---|---|
| [#4936](https://github.com/objectstack-ai/objectstack/issues/4936) | v17 对非空 `apis:` 响亮拒绝 + 执行残骸摘除 —— 本 ADR 依赖的清场前提（在飞） | spec |
| [#4939](https://github.com/objectstack-ai/objectstack/issues/4939) | `ApiRegistry` / `ApiEndpointRegistrationSchema` 同批退役，端点声明形状收敛为一套 | spec |
| [#5040](https://github.com/objectstack-ai/objectstack/issues/5040) | 17.x 端点执行器（E1–E8）。**E7 翻转 PR 落本 ADR 的全部 publish 门**：D1/D2 命名空间规则（替代原保留前缀族）、D6 匿名须限流、以及不支持子集的精确拒绝（`script` / `proxy` / mapping `transform` / 非 GET 的 `cacheTtl` / 缺 `objectParams` 的 `object_operation` / 同栈 `method+path` 重复） | 执行器 → spec |
| 同上（spec 车道执行项） | D3 判据写进 `ApiEndpointSchema` 与 `ActionType` 两侧 `describe()`（进生成 JSON Schema，AI 作者实际读到的那份） | spec |
| 同上（#5040 §4） | D5 同管线红线的测试化：flow 端点与 action 触发经同一 `execute` + 身份转发管线，逐字节同结果 | 执行器 |
