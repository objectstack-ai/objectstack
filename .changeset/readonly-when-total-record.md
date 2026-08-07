---
"@objectstack/objectql": patch
---

fix(objectql): 字段 `readonlyWhen` 在服务端看到的记录改为「对象声明的全量形状」(#4953)

`materializeDeclaredFields`(#1871 / #4649)此前只接在两个求值接缝上:
`evaluateValidationRules`(对象级校验规则、字段 `requiredWhen`、option
`visibleWhen`)与生命周期 hook 的 `condition`。**字段 `readonlyWhen` 不在其中** ——
写入路径上的 `stripReadonlyWhenFields` / `stripReadonlyWhenFieldsMulti` 直接把
`{ ...previous, ...data }` 交给 CEL 求值。

后果是同一个字段上的两条谓词对「记录是什么」给出相反答案:``requiredWhen:
P`record.approved_at == null` `` 是一条可用的守卫,而写在同一字段上的
``readonlyWhen: P`record.approved_at == null` `` 只要驱动没把 `approved_at`
这一列回读出来就会 fault;**而 `readonlyWhen` fault 是 fail-open**,于是作者声明
为冻结的字段被照常写入。某次写入是否被拦,取决于驱动回读了哪些列 —— 作者既看不见
也控制不了的存储细节。

本次把这两个 strip 的 `record` 与 `previous` 两个根都过 `materializeDeclaredFields`,
按维护者 2026-08-06 裁决(#4953)统一**服务端**接缝。

**这是一次可见的行为变化,方向如下:**

- 稀疏行上原本 fault→放行的谓词现在正常求值,谓词为真则改动被剥离(即恢复本应生效的
  只读约束)。`record.x == null` / `!= null` / `previous.x == null` 都属此类。
- 相应地,`has(record.<已声明字段>)` 在全量绑定下恒为 `true`(物化出的 `null` 是一个
  「存在且值为 null」的键,这是 CEL 自身的规则),`!has(record.<已声明字段>)` 恒为
  `false`。因此以 `readonlyWhen: !has(record.x)` 表达「x 为空时冻结」的写法**不再锁住
  字段** —— 它原本也不是一条保证(在回读全部列的驱动上它从来不锁),现在它变成确定的
  `false`。要表达「为空时冻结」请改写为 `record.x == null`(即 `@objectstack/lint`
  null-guard 闸门一直建议的写法)。

未改动的部分:`readonlyWhen` 的 fail-open 策略本身;#4889 的 `parent` 未绑定 ⇒
**LOCKED** 判定(`parent` 是另一个对象的行,不做物化);对象级 `script` /
`cross_field` 自 #4649 起的 fail-closed;INSERT 仍不走 `readonlyWhen` 剥离。
未读到前序行时(引擎未取或行已不存在)**不做**物化 —— 那样不是补齐缺失值,而是
凭空捏造一个与库中行相矛盾的值。
