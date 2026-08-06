---
"@objectstack/spec": minor
---

feat(spec): ADR-0117 scoped 接受 —— `owning_business_unit_id` 规范名进入登记处并列入公开表单拒收名单 (#4611)

ADR-0105 D13 的 promotion 工具要求「按子树的 scoping field 回填 `organization_id`」,
但没有任何元数据声明「哪个字段承载 BU 归属」。维护者裁定加速 ADR-0117 补上这一层。
本次落地**协议决定的名字面**,不含运行时注入。

- **ADR-0117 定稿为 `Accepted (D1/D3 scoped)`**:仅 D1(`business_unit` 档与
  `owning_business_unit_id` 记录戳的命名与语义)与 D3(`record.organization_id ==
  BU(owning_business_unit_id).organization_id` 不变量)进入协议;D5、D2 的默认盖章
  策略、D8 的启用门粒度、D4 的权限位仍为 Proposed,合并本 ADR 不构成对这四项的裁定。
- **新增 `SystemFieldName.OWNING_BUSINESS_UNIT_ID`**(`'owning_business_unit_id'`),
  明确标注 **open-core 暂不注入** —— 该表是**名字登记处而非注入集合**,`tenant_id` /
  `user_id` / `deleted_at` 是既有的三条同类先例。早登记是为了阻断消费方各造一个
  `business_unit_id` / `bu_id` / `dept_id`,即 cloud#982 用 `tenant_id`/`org_id`/`space`
  付过学费的漂移形态。
- **`PUBLIC_FORM_SERVER_MANAGED_FIELDS` 新增该名**:它是与 `owner_id` /
  `organization_id` 同类的归属锚点,一旦盖章,匿名面上被伪造的值会把记录推到别的部门
  墙后。在列存在**之前**就拒收是零成本且 fail-closed 的;等列上线后再补名单,中间那个
  版本就是一个带着发布号的洞。

**本轮刻意不动 `ownership` 枚举。** `packages/objectql/src/registry.ts` 的 `wantOwner`
是**排除式**判定(只排除 `'org'` / `'none'`),此刻加入第四个值会让 `business_unit` 档
照常注入 `owner_id` —— 与 ADR-0117 D1 表格恰好相反,属 ADR-0049「spec 不得声明运行时
不执行的东西」所禁止的形态。因此 `ownership: 'business_unit'` 目前仍被 Zod 响亮拒绝
(并列出 user / org / none 三个合法值),这是**正确**行为,已加 pin 钉住,防止后人
「顺手补全」。枚举值与其注入实现同 PR 落地。

**行为变更提示**:若某应用自行声明了名为 `owning_business_unit_id` 的业务字段并将其
放在匿名公开表单上,该字段自本版本起不再接受客户端提交的值。本仓内无任何此类声明;
ADR-0117 已将该名收为协议保留的系统列名。
