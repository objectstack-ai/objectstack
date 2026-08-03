---
"@objectstack/lint": minor
---

feat(lint): `has(x)` 不是 null 守卫 —— 发布期直接拒绝未守卫的可空比较 (#4763)

CEL 的 `has(x)` 问的是**键是否存在**。自 #4649 起,谓词读到的记录对对象声明的每个
字段都是**全量**的:一个声明了却存 `NULL` 的列同样"存在",所以
`has(record.end_date)` 对声明字段恒为 `true`,什么也没告诉作者。于是这个读起来
像守卫的写法根本不是守卫:

```text
has(record.start_date) && has(record.end_date) && record.end_date < record.start_date
```

它会走到 `null < null`,CEL 没有对应重载,整个谓词中断。#4761 之前中断被吞掉
(规则跳过,一条 WARN),也就是说**这一形状的规则在任何含 null 值的行上从未生效
过**——它写在元数据里、读起来完全正确、却什么都没有强制执行。#4761 把运行时改成
fail-closed 之后,当场就在我们自己的两个示例对象里抓到了它。

运行时拒绝是兜底,不是该学到这件事的地方:作者会在真实数据(很可能是生产数据)
上收到一个 400,离写下规则可能已经过去几个月。而这个错误**仅凭元数据就可判定**
——谓词的 AST 加上对象声明的字段类型,就足以判断某个操作数是否可能为 null。按
AGENTS.md PD #12(在创作期拒绝,不要在消费端容忍),它属于发布闸门。

**新增闸门(error,直接拒绝,没有降级开关)。** `os build` / `os validate` /
`os lint` 与运行时发布闸门共用的 `validateStackExpressions` 现在会拒绝这样的谓词:
对**声明为可空**的字段(没有 `required: true`、没有 `defaultValue`、没有默认选项、
不是 autonumber)应用**排序**(`< <= > >=`)或**算术**(`+ - * / %`,含一元 `-`)
运算符,而该操作数没有被同一布尔分支内支配它的 `!= null` / `== null` / `!isBlank()`
显式判空所守卫。`has(x)` **刻意不**计入守卫——这正是本规则存在的理由。错误信息点名
规则、操作数与修法,收尾句逐字取自 `rule-validator.ts` 的 `unevaluableRuleError`,
两道闸门措辞完全一致。

覆盖面(有意划定,而不是含糊地覆盖一半):对象**校验规则**(含 `conditional` 规则
`then` / `otherwise` 里嵌套的谓词)与**生命周期 hook 的 `condition`** ——即真正由 CEL
在全量记录上求值、会 fail-closed 的两类面。共享规则条件(下推成 SQL 过滤,`NULL > x`
是三值逻辑,不会 fault)、flow 的扁平作用域条件(裸标识符可能是 flow 变量)与
`Field.formula`(有自己的 #3306 `guard ? value : null` 处理)不在此列。

对**未声明**键的 `has()` 完全不受影响——那才是它的正当用途:区分"这次 PATCH 里
根本没提到这个键"与"显式写了 null"。示例应用无需改动即通过新闸门。
