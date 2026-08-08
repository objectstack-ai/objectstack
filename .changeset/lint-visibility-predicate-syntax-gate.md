---
"@objectstack/lint": minor
---

feat(lint): view/page 可见性谓词的 CEL 语法构建期闸门 —— `country === "USA"` 不再零诊断(#6253)

新增 **error 级** 规则 `visibility-predicate-syntax`:view/page 的可见性谓词
(`visibleWhen` 及其两个已弃用别名 `visibleOn` / `visibility`)如果规范 CEL 前端根本
解析不了,`os validate` / `os build` / `os lint` 一律拒收。`===` 这类写法从此发不出去。

按维护者 2026-08-07 对 #6253 的裁定落地:**判 blocking error**,与其它谓词面
(validation rule / flow / action,ADR-0032)同级;不设 warning 档,也不为本面写豁免——
warning 在 CI 里通常不拦,那只是「多绕几步的静默」。

**为什么这一面此前无人判**:`validate-expressions.ts`(ADR-0032)对它遍历到的每条谓词都跑
`validateExpression`,语法错报 blocking error——但它的遍历面是 objects / flows / actions /
sharingRules / hooks,**从不走 `views` 与 `pages`**。走这一面的三条规则(ADR-0089 D3b 两条
advisory,加 #6128 的裸标识符闸)都明确不判语法,理由是「不发明第二个语法判定」。那条政策
在它自己的调用点上成立(`validateExpression` 就在同一批调用点上跑),**在 view/page 面上不成立:
那里没有第二个判定,沉默就是没人报**。后果与 #5149 同型:谓词求值失败 → `evalFieldPredicate`
返回 fallback → 可见性 fallback 是 `true` → 元素无条件渲染,与「没写谓词」在屏幕上一模一样。
`packages/spec/src/ui/view.test.ts` 的 fixture 就写着 `'country === "USA"'`,正说明这是作者
(尤其 AI)会写出来的形状。

**判定仍然不是本包给的**——旧政策要保护的正是这一点,它完整保留:判定取 `parseCelToAst`
(规范前端,带 #3306 改写与 `DEFAULT_LIMITS`,#4812),本规则不自建 `Environment`、不手写
tokenizer。#6253 加的是**对既有判定的上报**,外加原始报错缺的自纠措辞:cel-js 只说
`Unexpected character: =` 并画一个 caret,既没点名作者写的运算符,也没给出 CEL 的写法。

**明确不走 `validateExpression` / `celEngine.compile`**,尽管那才是 ADR-0032 的入口:
`compile()` 是 parse **+ 类型检查**,差别不是理论上的——实测它会以
`no such overload: type == string` 拒掉 `type == 'grid'`,而那正是本文件**已钉测试的既有盲点**
(字段名与 CEL 类型名相同时不判,因为改读 overload 消息会误杀合法的 `type(record.x) == string`)。
从语法分支绕过去会把那条决定悄悄推翻,并把一条 error 级闸门从「解析不了」扩张成「类型检查不过」——
而这一面的谓词绝大多数是 `dyn`。裁定说的是语法,parse 判定恰好就是语法。

**消息自纠**:实测过的非 CEL 拼法各自点名并给出 CEL 写法——`===`→`==`、`!==`→`!=`、
`<>`→`!=`、`and`→`&&`、`or`→`||`、`not`→`!`、单个 `=`→`==`。扫描前先把字符串字面量抹平,
所以 `record.msg == 'a === b' and record.n > 1` 归咎于 `and` 而不是字面量里的 `===`;
`record.msg == 'a === b'` 本身能解析,压根不报。`??` 与 SQL 的 `IN (…)` 故意不进表:两者
都会解析失败、都照报(带前端原话),但都没有「换一个 token」就能修好的等价写法,给半个修法
只会让作者多跑一趟。

**边界**(均已钉测试):空/纯空白谓词不是语法错(`parseCelToAst` 对空源也返回 `null`,
没有这道 guard 会把「没写谓词」报成坏 CEL);`DEFAULT_LIMITS` 超限属于**边界**错而非语法错,
照报但引用前端原话、不假装找到了 typo,与 ADR-0032 把两者一并归入「invalid CEL predicate」
的既有做法一致,且超长谓词在消息里省略,单条 runaway 表达式刷不满控制台;一条坏谓词**只出一个
finding**——源码解析不出 AST 就没有标识符可判,裸标识符闸自动让位,该互斥性由「断言整个上报集合」
钉住而不是靠调用方内部实现。

注册表无需改动:`validateVisibilityPredicates` 的 tier 在 #6128 已是 `gating`、commands 已是
build/lint/validate,本规则的 `error` 直接沿用(已加测试复核该前提仍然成立)。

仓内清扫:除 `packages/spec/src/ui/view.test.ts` 那几条**纯 schema 测试样本**(它们只跑
`FormFieldSchema.parse`,不经 lint,属于本单援引的证据而非待修点)外,全仓 examples / apps /
packages 的 view/page 可见性谓词均能通过规范前端解析,无需修改任何示例内容。
