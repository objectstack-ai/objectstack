---
"@objectstack/lint": patch
---

fix(lint): 收敛 `validateRuleCompilability` 里读 spec 不声明键的 `??` 别名链 (#5096)

#4984 → #5009 → #5017/PR #5046 同族第八处,落在第三个文件
(`validate-rule-compilability.ts:239`):

| 原读法 | spec 事实(对 live `.shape` + `safeParse` 实测) | 处置 |
|:--|:--|:--|
| `obj.validations ?? obj.validationRules` | `ObjectSchema.shape` 只声明 `validations`,且 strict —— `validationRules` 被**按名拒绝**:`Unrecognized key(s) on this object: \`validationRules\`. … Did you mean \`validationRules\` → \`validations\`?`(#4001) | 收敛为 `obj.validations` |

该规则以 `input: 'parsed'` 注册,canonical 排首位,所以别名 limb 对任何能解析的
stack 都不可达 —— 三个 example(crm / showcase / todo,共 28 个对象、17 条验证规则)
上改动前后 findings **逐字相同**(两侧均 0 条)。

**代价从来不是漏报,而是误导。** 一个写在 consumer 里的别名 fallback,等于向后来的
读者、以及照着这份源码写元数据的 AI 宣称 `objects[].validationRules` 是一个真实的
authoring 面;它把 schema 一句指名道姓的拒绝,降级成一条静默失效的分支。别名容忍属于
producer 的拒绝面,不属于 consumer(Prime Directive #12)。

同时给本文件补上两层结构性 meta-guard(#4992 模式,#5017 形状),让下一条死读法在
review 前就红:

- **declared-key guard** —— 规则源码里从 `stack` / `obj` / `rule` 上读的每个键,必须
  出现在对应 surface 自己的 Zod `.shape` 里,且 `expected` 精确匹配;另加一条 "covers
  every receiver" 元测试,以及一条针对 `flattenRules` 里 `rule[branch]` **计算属性**
  读法的专项断言(点号扫描看不见它,而 `then` / `otherwise` 恰是本规则最有意思的读法)。
- **reachability guard** —— 两个 `findings.push` 落点都必须被一条 `ObjectStackSchema`
  **完整 parse 通过**的 fixture 触达。这里用的是 #5018 的 `safeParse` 全绿判据,比
  `validate-security-posture` 只能要求"不报 `unrecognized_keys`"更严一档 —— 因为本规则
  判的是"编译不过",而在 spec 眼里 `regex` 是任意字符串、`schema` 是任意 record,编不过
  的产物依然完全 spec 合法:这条 gate 存在的理由正是 zod 看不见该缺陷,所以它永远不需要
  一条 zod 会拒绝的 fixture。

原测试 `reads \`validationRules\` too` 断言的正是被删掉的那条 limb,实测确实产出 1 条
finding(不是空转),因此它被**替换**而不是改拼写:把 key 换成 canonical 只会留下一条
主题已不存在的绿测试。变异测试:别名 limb 加回去 → 2 条红;改成纯别名读 → 11 条红。
