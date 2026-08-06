---
"@objectstack/spec": minor
"@objectstack/objectql": patch
"@objectstack/lint": patch
---

fix(lint,spec,objectql): 编写期表达式与 `highlightFields` 校验识别注册表注入的系统列 (#5378)

平台在每个业务对象上注入 `owner_id` / `created_at` / `organization_id` 等系统列,
文档也把 `ownership: 'user'` 写作 "injects reassignable owner_id"。但编写期的两处
校验只读**作者声明的** `fields`,于是注入列一律当作不存在:

- `validate-expressions.ts` 的 `buildFieldIndex` 让 `has(record.owner_id)` 直接
  报错 `unknown field owner_id`;
- `highlightFields` 存在性检查对 `['owner_id']` 发出 "is not a field on this
  object — it is silently skipped by every consumer"。

也就是平台自己的 linter 否认平台自己的契约。结果是应用被迫**重声明系统列**才能通过
编写期校验:hotcrm#548 为此在全部 12 个业务对象上显式声明了 `owner_id`(6 个对象曾
报 `highlightFields` 警告,`contact_welcome` 触发器的 `has(record.owner_id)` 被硬
拒)。这正是本项目视为缺陷的形状:能力已声明(列确实注入且有文档),但执行层不认。

**权威来源只有一份。** 新增纯派生 `resolveInjectedSystemColumns()`
(`@objectstack/spec/data`)回答"这个对象带哪些系统列",并由 registry 的
`applySystemFields()` **消费**它——沿用 #3786 为审计字段族确立的分工:spec 声明
**有哪些**列,registry 拥有**每列长什么样**。lint 通过同一派生取答案,因此编写期
判断与运行时注入不可能不一致(`@objectstack/lint` 的包契约是"只依赖 spec,绝不依赖
运行时",此前它根本无法读到权威)。两个消费面共用同一判定,不各写一份。

**并入是按对象有条件的**,不是无条件放行整张系统列名单:`ownership: 'org' | 'none'`
的对象没有 `owner_id`,那里的 `record.owner_id` 仍然是真错误并继续报;
`tenancy.enabled: false` 无 `organization_id`;`systemFields: { audit: false }` 无
审计四列;`systemFields: false` / `managedBy: 'better-auth'` 什么都不注入(只剩驱动
提供的主键 `id`)。真正拼错的字段照旧被拒,并且注入列现在也进入 "did you mean?" 候选
(`record.ownerid` → 提示 `owner_id`)。

被解析的注入列在诊断与补全语义上与授权字段等同;类型健全性与 null-guard 两个索引
**刻意**仍只读声明字段,原因写在各自注释里:列的 `type` 与可空性属于 registry 的列
定义,在 lint 侧另立一份就是本次要消灭的第二份副本,而 null-guard 喂的是会中断构建的
判定,擅自并入会让今天能构建的 stack 变红。

注入行为本身零改动:`applySystemFields` 的输出在全条件矩阵上逐列不变(新增 parity
pin 用实跑注入代码比对)。已显式重声明系统列的应用不受影响——重声明仍然合法,
examples 三个 app 的 `os validate` 输出改动前后完全一致。
