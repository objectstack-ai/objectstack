---
"@objectstack/objectql": patch
---

fix(objectql): `wantOwner` 由排除式改为正面清单,并注入 `owning_business_unit_id`(ADR-0117 D1,#5677)

`applySystemFields` 判定是否注入 `owner_id` 的 `wantOwner` 原本是**排除式**的
(`ownership !== 'org' && ownership !== 'none'`):只有两个值被排除,任何第四个
`ownership` 值都会掉进默认分支、照常被盖上 `owner_id`。这与 ADR-0117 D1 的表格
**恰好相反**——新增的 `business_unit` 档的全部含义就是「归属于组织单元而非个人」
(`owner_id` ❌、`owning_business_unit_id` ✅)。#4611 的一次性探针已实测确认过这个
反向结果。

**翻面。** 判定改为正面清单 `ownership === undefined || ownership === 'user'`
(`managedBy` 平台表与 `sys_` 命名空间的跳过规则不变)。对今天存在的三个值
**行为完全不变**:`undefined`/`user` 照常注入,`org`/`none` 照常排除;唯一的变化是
新档位不再靠「落进默认分支」继承 owner 语义。这是先决单点:先翻面,枚举扩展
(#5678)才是安全的。

**注入 `owning_business_unit_id`。** 记录级组织单元归属(lookup → `sys_business_unit`),
按 D1 表格覆盖 `undefined`/`user`/`business_unit` 三档,`org`/`none` 不注入。

| `ownership` | `owner_id` | `owning_business_unit_id` |
|---|---|---|
| `undefined` / `user` | ✅ | ✅ |
| `business_unit` | ❌ | ✅ |
| `org` / `none` | ❌ | ❌ |

**用户可见的行为变化**:声明 `ownership: 'business_unit'` 的对象此前会被误注入
`owner_id`,现在改为注入 `owning_business_unit_id`。(该值今天仍被 `ObjectSchema`
的枚举拒收 —— 枚举扩展在 #5678,严格后置于本单;所以本次发布中这条路径只有
引擎侧就绪,尚无法从元数据声明触达。)

列的形态比照 `organization_id`(服务端盖章的作用域锚点)而非 `owner_id`(用户可指派
的业务字段):`readonly: true` + `hidden: true` + `required: false`,不建索引。三者
都**不预设** ADR-0117 D2 尚未裁定的盖章策略(`pinned`/`follow_owner`/`transferable`)
——它们不授予任何能力,因此 D2 的每种结论都仍然可达;盖章中间件(D2/D4)与回填
(D8)落地前,该列被提供但处于惰性状态(恒为 NULL)。

`packages/spec` 未改动:`SystemFieldName.OWNING_BUSINESS_UNIT_ID` 的 JSDoc 与
`object.zod.ts` 的描述同步在 #5767。该名早已在公开表单 server-managed 拒收名单上
(#4611 提前登记),因此新列从第一天起就不可由匿名面客户端提供。
