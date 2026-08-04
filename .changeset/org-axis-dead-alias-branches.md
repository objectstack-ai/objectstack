---
"@objectstack/lint": patch
---

fix(lint): 清除 `validateOrgAxisRedLines` 里 spec 合法 stack 永远到不了的四条分支 (#5009)

`validate-org-axis-red-lines.ts` 是 `input: 'parsed'` 规则 —— 它看到的是
`ObjectStackSchema` 解析后的产物。#4984 修掉了 sharing rule 字段那一层的 `??`
别名读法,但同一文件里还留着四条同形分支,每一条读的键 spec 都不声明:

| 原读法 | spec 事实 | 处置 |
|:--|:--|:--|
| `cfg.permissions ?? cfg.permissionSets` | stack 根 **strip** 未声明键,`permissionSets` 解析后必为 `undefined` | 收敛为 `cfg.permissions` |
| `cfg.sharingRules ?? cfg.sharing`(两处) | 同上 | 收敛为 `cfg.sharingRules` |
| `str(rule.object ?? rule.objectName)` | `SharingRuleSchema` 是 `.strict()`,按名拒绝 `objectName`;`object` 又是必填 | 收敛为 `rule.object` |
| `asArray(object.rowLevelSecurity ?? object.rls)` 整段(约 20 行) | **`ObjectSchema` 两个键都不声明**,且 `.strict()` —— 带对象级 RLS 的 stack 在 `os validate` / `os build` 直接被拒("Unrecognized key(s) on this object") | **删除** |

对任何 spec 合法的 stack,判定结果不变:这些分支本来就永远不执行(反向验证 ——
新测试跑在改动前的实现上,29 条由 `safeParse` fixture 驱动的断言全绿)。真正的
代价从来不是漏报,而是误导:对象级 RLS **根本不是授权面**(`authorable-surface.json`
里只有 `security/PermissionSet:rowLevelSecurity` 一条),而那段死代码连
`objects[N].rowLevelSecurity[M].using` 的诊断 path 都写好了,足以让下一位作者
(人或 AI)相信它是真的并照着写更多代码 —— #5008 差点就这么做了。

行为上唯一的差别落在 `os lint`(不 parse,跑 normalized 层):把别名拼法写进
stack 的作者,不再从这条红线拿到诊断,而是从 schema 那里拿到一条指名道姓的
拒绝。别名容忍属于 producer 的拒绝,不属于 consumer(Prime Directive #12)。

同时补上一层结构性 meta-guard(#4992 模式),让下一条死分支在 review 前就红:

- **declared-key guard** —— 规则源码里从 stack / permission set / RLS policy /
  object / sharing rule 上读的每一个键,都必须出现在对应 schema 自己的 `.shape`
  里。扫源码而不是扫行为是刻意的:不可达分支根本没有行为可断言。
- **reachability guard** —— 每个 `findings.push` 调用点都必须被至少一条过
  `safeParse` 的 fixture 触达;走不到的分支不允许存在。
- 规则 ① 的 fixture 现在也走 `PermissionSetSchema.safeParse`(此前只有 sharing
  rule 和 object fixture 有这层保护)。

四条分支各自被变异测试验证过:把任意一条加回去,都至少有两条测试转红。
