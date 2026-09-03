# ADR-0117: 记录级业务单元归属（owning business unit）

- **状态**: **Accepted (D1/D3 scoped)**（2026-08-05）—— 仅 **D1**（`ownership` 新增
  `business_unit` 一档与 `owning_business_unit_id` 记录戳的命名与语义）与 **D3**
  （`record.organization_id == sys_business_unit(owning_business_unit_id).organization_id`
  不变量）进入协议。**D5、D2 的默认盖章策略、D8 的启用门粒度、D4 的权限位选择仍为
  Proposed**，见文末「未决问题」——合并本 ADR **不**构成对这四项的裁定，它们需各自单独评审。
- **日期**: 2026-07-31（提案）/ 2026-08-05（scoped 接受）
- **裁定依据**: #4611（ADR-0105 D13 的「scoping field」无元数据落点）维护者 2026-08-05
  选 1 —— 加速 ADR-0117，使 promotion 获得可校验的后置条件。该裁定回答了本 ADR 未决问题
  第 2 条（这一档值得新增），其余四条未被触及。
- **关联**: ADR-0057（BU 树与深度档位）、ADR-0090（岗位与任职锚点）、ADR-0091（授权时效）、
  ADR-0103（`managedBy` 写策略）、ADR-0105（租户姿态与 org 作用域）
- **动因**: 集团管控场景需要"记录属于哪个部门/法人"成为结构事实，而不是从所有者推导

## 背景

### 现状：记录归属只有两个坐标，中间一层缺失

今天一条业务记录携带两个系统维护的归属标记：

- `owner_id` —— 人。由 registry 按 `ownership` 轴自动注入
  （`packages/objectql/src/registry.ts` `applySystemFields`），SecurityPlugin 在插入时
  盖章，改动受 `allowTransfer` / `modifyAllRecords` 约束。
- `organization_id` —— 租户墙。列无条件注入（`packages/objectql/src/registry.ts#organization_id`，除显式
  `systemFields.tenant === false` / `tenancy.enabled === false` 外），值由多组织运行时
  权威盖章。

**中间的一层——"这条记录属于哪个部门 / 哪个法人"——不存在。** 它今天是从所有者
*推导*的：层级深度档位（`unit` / `unit_and_below` / `own_and_reports`）最终编译成
`owner_id IN (…)`（`packages/plugins/plugin-sharing/src/sharing-service.ts#owner_id`），
即"这条记录归属于当前在该组织单元里的某个人"。

### 这个推导带来三个问题

1. **归属漂移**：所有者调动部门，其历史单据的部门归属无声跟随。对订单、凭证、工单
   这类"钉在开出它的组织上"的记录，语义是错的——人走单不该走。
2. **无所有者语义的数据没有归属**：库存、设备台账、共享主数据属于组织而不属于个人，
   owner 派生模型对它们无话可说。
3. **报表没有可聚合列**：按部门汇总成本、按法人出报表需要行上有一个能 `GROUP BY`
   的列；`owner_id IN (一大串人)` 既不能用于聚合，谓词规模也是用户数量级。

### 业界坐标

- **Dataverse**：每条记录带 `owningbusinessunit`，与 `ownerid` 并存；表分
  User/Team-owned 与 Organization-owned 两类——与本仓既有的
  `ownership: 'user' | 'org' | 'none'`（`packages/spec/src/data/object.zod.ts#ownership`）
  同构。
- **SAP**：凭证同时携带成本中心与公司代码，法定报表按公司代码出。

### 可复用的既有部件

| 部件 | 位置 |
|---|---|
| 记录归属轴声明 `ownership` | `packages/spec/src/data/object.zod.ts#ownership` |
| 系统字段注入管线 `applySystemFields` | `packages/objectql/src/registry.ts` |
| BU 树与子树遍历 | `packages/platform-objects/src/identity/sys-business-unit.object.ts`、`packages/plugins/plugin-sharing/src/business-unit-graph.ts` |
| 用户主 BU 投影（**注意：这是用户属性，不是记录戳**） | `packages/platform-objects/src/identity/sys-user.object.ts`、`plugin-sharing/src/primary-bu-projection.ts` |
| 私有+层级对象必须带 org 列的门 | EE `hierarchy/tenant-scope-gate.ts` |

## 决策

### D1 字段与注入：挂靠既有 `ownership` 轴，新增一档

字段名 **`owning_business_unit_id`**（lookup → `sys_business_unit`）。注入规则由对象级
`ownership` 决定，该枚举**扩展一档**：

| `ownership` | `owner_id` | `owning_business_unit_id` | 适用 |
|---|---|---|---|
| `user`（默认） | ✅ | ✅ | 有责任人的业务对象（订单、工单、商机） |
| **`business_unit`**（新） | ❌ | ✅ | 属于组织单元而非个人（库存、设备台账、部门预算） |
| `org` | ❌ | ❌ | 全组织目录/编目表 |
| `none` | ❌ | ❌ | 连接表 |

`managedBy` 平台表与 `sys_` 命名空间照现有规则跳过注入。

### D2 盖章策略：按对象声明，默认"钉死"

对象可声明 `owningBusinessUnit.policy`：

| 策略 | 语义 | 默认适用 |
|---|---|---|
| **`pinned`（默认）** | 插入时盖章，此后不随所有者变动 | 单据、凭证、工单——ERP 语义 |
| `follow_owner` | 所有者变更时重算为新所有者的主 BU | CRM 语义（客户随销售转移） |
| `transferable` | 仅允许显式重新指派，不自动重算 | 需要人工调拨归属的对象 |

**默认值来源**（插入时，按序）：① 调用方显式传入且通过 D4 守卫；② 所有者的
`primary_business_unit_id` 投影；③ 若对象声明 `owningBusinessUnit.required = true`
则**拒绝插入**并给出可操作错误（"当前账号无主业务单元，请联系管理员分配"），
否则留空。

### D3 不变量：`org_id` 由 BU 链推导

**`record.organization_id == sys_business_unit(owning_business_unit_id).organization_id`**

盖章中间件在服务端推导并校验；客户端传入的值一律被覆盖而非采信（与
`organization_id` 现有的权威盖章纪律一致）。两个戳因此不可能互相矛盾，也不存在
"把记录塞进别的公司"的写入路径。

### D4 写入守卫：归属变更是转移类操作

- 改动 `owning_business_unit_id` 复用 **`allowTransfer`**（或 `modifyAllRecords`）
  ——语义上与改 `owner_id` 同类：都是重新指派记录归属；
- 且**目标 BU 必须落在调用方的写作用域内**，否则拒绝。这防止"把记录推到自己看不见
  的地方"或"从别人手里拉过来"两种越权形态；
- `pinned` 策略下，即便持有 `allowTransfer` 也不允许改（策略优先于权限位）。

### D5 法人归属：解析规则，不新增列 ⚠️ *偏离父 ADR，需评审*

"这条记录属于哪个法人"的答案由部署形态决定：法人建成组织时是 `organization_id`；
法人建成 `kind='company'` 的 BU 节点时，是 `owning_business_unit_id` 沿树向上最近的
company 祖先。本 ADR **提供框架侧解析helper，不新增物化列**。

理由：物化列若要同时指向组织行与 BU 行，只能做成多态外键，代价大于收益；而两种
部署形态下答案都可由既有两个戳解析得出。**这偏离了上游"盖章时物化"的表述**，
若报表性能实测需要，可后续按 `primary_business_unit_id` 的先例增加去规范化投影列。
提交评审确认。

### D6 契约变更：解析器返回"谓词规格"而非 owner id 列表 💥 *破坏性*

现契约只能表达所有者集合：

```ts
// packages/spec/src/contracts/sharing-service.ts#resolveOwnerIds
resolveOwnerIds(ctx, scope): Promise<string[]>
```

改为返回**按哪个戳过滤**的规格，由 `sharing-service` 编译成对应列的谓词：

```ts
type ScopeResolution =
  | { field: 'owner_id'; ids: string[] }                    // own 档保留
  | { field: 'owning_business_unit_id'; ids: string[] }     // unit / unit_and_below
  | { field: 'organization_id'; ids: string[] }             // 公司轴（后续）
resolveScope(ctx, scope): Promise<ScopeResolution>
```

`packages/plugins/plugin-sharing/src/sharing-service.ts#OWNER_FIELD` 的 `OWNER_FIELD` 硬编码随之解除。这是**破坏性契约变更**，
唯一实现方是企业版层级解析器，需与其同步发布。收益：谓词从"数千用户"缩短为
"几十个 BU"，归属漂移消除，且为公司轴（`organization_id`）留出同形位置。

### D7 豁免：哪些对象不参与

`ownership` 为 `org` / `none` 的对象、显式关闭租户列的对象、以及被声明为集团集中
管控的配置/主数据对象，**不注入该列，也不受 BU 轴过滤约束**——集团统一维护的科目
表、客商不应因"调用方的 BU 集合不含集团根"而被挡掉。豁免清单必须显式维护；遗漏的
表现形式是"子公司看不到集团主数据"。

### D8 迁移：回填 + 启用门（fail-closed）

存量记录该列为空。空值在 BU 轴过滤下不可见——若直接开启，会把历史数据从所有
unit 档用户眼前抹掉。因此：

1. 提供回填作业：按 `pinned` 语义从记录所有者当时的主 BU 推导（无法推导的留空并
   计数）；
2. **启用门**：BU 轴过滤在某对象上启用前，校验该对象无未回填行，否则拒绝启用并
   报告待回填数量。**不做"空值回退到 owner 判定"的兼容层**——那会把迁移期变成
   两套并存的事实契约（AGENTS.md「契约优先」）。

### D9 开源 / 企业边界

- **开源（framework）**：列的定义与注入、盖章中间件、D3 不变量、D4 守卫、回填与
  启用门。结构与归属是所有部署都该有的能力；
- **企业版**：由哪些 BU 构成作用域集合的**层级解析**（`hierarchySecurity`）。

这与"结构开放、隔离与层级付费"的既有边界一致，也让无企业版许可的部署照样获得
正确的部门归属与报表列。

### D10 命名纪律

**不得复用 `primary_business_unit_id`**。它是 `sys_user` 上的用户属性（由
`sys_business_unit_member.is_primary` 投影而来），与本 ADR 的记录戳是不同对象上的
不同概念；同名会造成难以察觉的语义混淆。

## 后果

**正面**

- 部门/法人归属成为**结构事实**：报表可直接按列聚合，审计可直接回答"这条记录属于
  哪个组织单元"，不再依赖"它的所有者现在在哪"；
- **归属漂移消除**：所有者调动不再改变单据的组织归属（`pinned`），而确需跟随的
  对象仍可声明 `follow_owner`——两种业务语义都能表达；
- **谓词大幅缩短**：层级档位从 `owner_id IN (数千用户)` 变为
  `owning_business_unit_id IN (几十个 BU)`，并可退役 owner 集合的展开与缓存；
- **无所有者的数据获得归属**：`ownership: 'business_unit'` 覆盖库存、台账这类对象；
- 为公司轴（`organization_id` 过滤）留出同形位置，无需再改一次契约。

**负面 / 成本**

- **D6 是破坏性契约变更**，必须与企业版层级解析器同步发布；
- **迁移有真实工作量**：回填作业 + 启用门 + 无法推导行的人工处理；
- 新增一个对象级声明（`owningBusinessUnit`）与一档 `ownership` 值，元数据面变宽；
- D7 豁免清单需长期维护，遗漏的故障形态（子公司看不到集团主数据）在测试里不显眼，
  需要专门的 conformance 用例守住。

## 落地状态（2026-08-05，scoped 接受时）

被接受的 D1/D3 是**协议决定**，其运行时执行分两步落地，本轮只完成第一步：

| 面 | 本轮（#4611） | 后续 |
|---|---|---|
| 规范名 `owning_business_unit_id` | ✅ 已登记为 `SystemFieldName.OWNING_BUSINESS_UNIT_ID`，标注 **open-core 暂不注入**，并进入公开表单 server-managed 拒收名单（防御纵深，匿名面永不可由客户端提供） | —— |
| `ownership: 'business_unit'` 枚举档 | ❌ **本轮不加**。`packages/objectql/src/registry.ts` 的 `wantOwner` 是**排除式**判定（只排除 `org` / `none`），此时加入枚举会让该档照常注入 `owner_id`，与 D1 表格相反 —— 属 ADR-0049 所禁止的「声明而不执行」 | #5678（须与 #5677 同 PR 或严格后置） |
| 列注入（`wantOwner` 翻为正面清单 + 列） | ❌ 未实现 | #5677（engine-core 车道） |
| 盖章策略（D2）/ D3 校验 / D4 守卫 / D8 迁移 | ❌ 未实现，且 D2 默认值等四项**尚未裁定** | 各自单独评审后再开单 |

即：**协议已接受，执行待实现**；在注入落地前，`ownership: 'business_unit'` 会被 Zod
以「合法值为 user / org / none」响亮拒绝，这是**正确**行为，不得「顺手补全」。

## 未决问题

**已裁定**

- ~~2. **`ownership: 'business_unit'` 是否值得新增**~~ —— **是**（#4611 维护者 2026-08-05
  裁定选 1）。ERP 场景（库存、台账、部门预算）有真实需求，且 promotion 的可校验后置条件
  依赖它。

**仍待评审（合并本 ADR 不视为通过）**

1. **D5 的偏离**：法人归属做成解析规则而非物化列，是否接受？（上游表述为"盖章时
   物化"。）若坚持物化，需先决定多态外键 vs 两个可空列。
2. **`pinned` 作为默认值**是否正确——平台既有对象以 CRM 形态居多，默认 `pinned`
   会与它们的直觉相反；但对新建的 ERP 类对象，默认 `follow_owner` 更危险。
3. **D8 启用门的粒度**：按对象启用，还是按部署一次性启用？前者迁移更平滑，后者
   语义更简单。
4. **是否需要独立的权限位**（如 `allowChangeOwningUnit`）而不是复用 `allowTransfer`。
