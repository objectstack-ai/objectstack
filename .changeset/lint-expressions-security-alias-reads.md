---
"@objectstack/lint": patch
---

fix(lint): 收敛 `validateStackExpressions` / `validateSecurityPosture` 里读 spec 不声明键的 `??` 别名链 (#5017)

两条规则都以 `input: 'parsed'` 注册,看到的是 `ObjectStackSchema` 解析后的产物。
#4984 → #5009 清掉了 sharing rule 字段层和 org-axis 规则里的同形读法;这一轮是同族
第三轮,落在另外两个文件。议题点名五条,全包 grep 又找出同形的两条,一并处置:

| 原读法 | spec 事实 | 处置 |
|:--|:--|:--|
| `rule.expression ?? rule.predicate ?? rule.condition ?? rule.formula`(两处) | 四个别名全是 `validation.zod.ts` 的 `aliases: { …: 'condition' }` **按名拒绝**的键;canonical 排第三 | 收敛为 `rule.condition` |
| `obj.validations ?? obj.validationRules` | `ObjectSchema` 只声明 `validations`,strict 按名拒绝 | 收敛为 `obj.validations` |
| `rule.condition ?? rule.criteria ?? rule.predicate` | `criteria` 是运行时编译产物 `criteria_json` 的拼法(#3896),`predicate` 直接拒绝 | 收敛为 `sharingRule.condition` |
| `def.reference ?? def.referenceTo` | `field.zod.ts:331` 把 `referenceTo` 映射为 `reference` | 收敛为 `def.reference` |
| `action.objectName ?? action.object` | canonical 是 `objectName`;`object` 按名拒绝 | 收敛为 `action.objectName` |
| `obj.sharingModel ?? (obj.security)?.sharingModel` | **`ObjectSchema` 根本没有 `security` 键** —— OWD 三个拨盘是平铺的,且 strict:嵌套写法被整包拒绝 | **删除整个 fallback** |
| `def.reference ?? def.reference_to` | 同 `referenceTo` | 收敛为 `def.reference` |

对任何能解析的 stack,判定结果不变 —— 三个 example(crm / showcase / todo)与平台
default permission sets 上,改动前后两条规则的 findings 逐字相同。

**其中一条不是死代码,是活着的错。** `rule.expression ?? … ?? rule.condition ?? …`
把 canonical 的 `condition` 排在两个被拒别名之后,所以一条同时写了 `condition` 和
`expression` 的规则,lint 校验的是 schema 会拒绝的那个,而作者声明的那个**从头到尾
没被看过**:producer 和 consumer 对同一份元数据给出两套说法。测试里重建了旧链来演示
这个差异,而不是只描述它。

真正的代价从来不是漏报,而是误导 —— `object.security.sharingModel` 出现在**安全
linter**里,足以让下一位作者(人或 AI)相信对象级 `security` 信封是真实的授权面。

同时补上两层结构性 meta-guard(#4992 模式,#5018 形状),让下一条死读法在 review
前就红:

- **declared-key guard** —— 规则源码里从每个 surface 上读的键,必须出现在该 surface
  自己的 Zod `.shape` 里。扫源码不是扫行为是刻意的:不可达分支没有行为可断言。
- **reachability guard** —— `validateSecurityPosture` 全部 15 个 `findings.push`
  落点都必须被一条 schema **不报 `unrecognized_keys`** 的 fixture 触达。判据不是
  #5018 的 `safeParse` 全绿,而这正是这条规则的特点:它被文档明确设计为也跑在
  parse 前,好让 `os lint` 对 zod 会拒绝的**值**(`sharingModel: 'read'`)给出更
  好的信息。被拒的**值**和被拒的**键**是两回事 —— 后者在 parsed 路径上压根到不了。

七条读法各自做过变异测试:任意一条加回去,都至少有一条测试转红。
