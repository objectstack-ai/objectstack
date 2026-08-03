---
"@objectstack/lint": minor
---

feat(lint): null-guard 闸门覆盖 `requiredWhen`,其余各面按"绑定是否全量"逐一定案 (#4811)

#4763 的 null-guard 闸门只接了两面(对象校验规则、生命周期 hook `condition`),
其余各面留作"待定"。本次把"待定"收敛成一条**可判定的判据**,并按它逐面定案 ——
一个只覆盖部分面、又没有任何东西说出这件事的闸门,正是这一族缺陷本身的形状。

## 判据:记录绑定是否对已声明字段**全量**

这不是口味问题,也不是"这个谓词是不是 CEL"。实测 `@marcbachmann/cel-js`,两种绑定
下的语义**恰好相反**:

| 谓词 | 全量绑定 `{a: null}` | 稀疏绑定 `{}` |
|:--|:--|:--|
| `has(record.a)` | `true` ← 陷阱 | `false` ← 真守卫 |
| `record.a < record.b` | FAULT `no such overload` | FAULT `No such key: a` |
| `record.a != null` | `false` ← **修法有效** | FAULT `No such key: a` |

即:全量绑定下 `has()` 恒真而无用、`!= null` 是解药;稀疏绑定下 `has()` 恰恰是正确的
守卫,而 `!= null` **自身就会 fault**。把闸门指向一个稀疏绑定的面,等于判红正确的元数据、
并给出一个会把它改坏的"修法" —— 比不覆盖更糟。所以:**只有绑定全量的面才可以接入。**

## 纳入:字段 `requiredWhen`

议题没有列出这一面,而它恰恰是唯一满足判据的:`evaluateValidationRules` 用与对象校验
规则**同一个** `materializeDeclaredFields` 合并记录来求值 `requiredWhen`。

它也是几个已覆盖面里失败得最安静的一个:`requiredWhen` 谓词 fault 时是 **fail-open** ——
`rule-validator.ts` 记一行 `failed to evaluate — skipped` 就跳过,字段于是**从未真正必填**,
写入照常通过。校验规则至少自 #4761 起是 fail-closed 的拒绝。因此报错文案按面区分后果:
"被跳过、字段从未必填"与"写入被 fail-closed 拒绝"是两个相反的故障,作者需要知道自己
碰到的是哪一个。

## 排除,且各自留下可引用的理由

- **action `visible` / `disabled`**:谓词确实走真 CEL(裸串经 `ExpressionInputSchema`
  规范成 `{dialect:'cel'}` 信封,渲染器保留它),fault 也确实 fail-closed —— 陷阱在这一面
  是真的。但绑定是客户端已取到的那条记录(详情读取,或只带列表视图投影列的一行),
  `objectui` 这条路径上不存在任何物化步骤。稀疏绑定下 `!= null` 是错的修法。要覆盖它,
  得先决定是否把该绑定做成全量 —— 那是平台契约改动,不是 lint 改动。
- **flow / edge `condition`**:议题记的理由(扁平作用域下裸标识符可能是 flow 变量)对本
  模块**不成立** —— 它只解析 `record.<f>` / `previous.<f>`,从不解析裸标识符,而引擎无
  条件绑定这两个根。真正的阻碍还是全量性:`record-change-trigger.ts` 把记录播种为
  `{ ...inputDoc, ...after }`,没有 `materializeDeclaredFields`,所以写入未提及的已声明列
  是**缺键**而非 null,`!= null` 会和它本要守卫的比较一样 fault。
- **字段 `readonlyWhen`**:与 `requiredWhen` 同一个字段、相反的结论 —— 它由
  `stripReadonlyWhenFields` 求值,那里合并的是 `{ ...previous, ...data }`,从不物化。
- **`Field.formula`**:按产品判断排除,而非按本判据。formula 是 `value` 角色、天然可空,
  `guard ? value : null` 是被祝福的写法(#3306)。是否强制守卫会改变"作者被允许写什么",
  该由维护者决定,不是一个接线缺口。

判据、实测表与逐面台账写在 `validate-null-guards.ts` 的模块注释里,每条排除在它对应的
调用点也留了注释,并各配一条断言钉住。

## 顺带修正:`field '?'`

诊断的字段名此前走 `Object.values(fields)`,把**名字键**丢掉了 —— 而名字键正是
`Field.text({…})` 这种(最常见的)写法产生的形状,于是这类对象上的每条字段级诊断都定位在
`field '?'`。名字只出现在 `where` 里时还能忍;现在报错正文要告诉作者改哪个字段,就不能忍了。
