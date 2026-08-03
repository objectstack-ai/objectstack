---
---

chore(tooling): 把 `docs/` 的活语料纳入 doc-authoring 守卫,历史快照按路径豁免 (#4929)

`scripts/check-doc-authoring.mjs` 的 `ROOTS` 一直是 `['.claude', 'skills', 'content']`。
#4916 修的是「声明了但解析不到的 root」;这条是它的**对称方向** —— 一个真实存在、
真的在教 metadata 编写、却从来没被声明过的目录。`docs/` 就是那个目录:
`docs/notes/crm-development-standards.mdx` 单独一份就有 16 个 ts 围栏块,
ADR-0010 / 0015 / 0017 / 0057 和 `docs/design/permission-model.md` 里都有 `defineX(...)`。
AGENTS.md Prime Directive #13 要求每个 agent 在改动 ADR 治下的行为前先 grep ADR,
所以一份 ADR 里的裸字面量会被下一个 agent 原样抄进 app 代码,和 `skills/` 里的坏样本没有区别。

`ROOTS` 现为 `['.claude', 'docs', 'skills', 'content']`。取 `docs` 而不是三个子目录,
理由与 #4913 取 `.claude` 而非 `.claude/skills` 相同:以后新增的子目录**一进来就在范围内**,
不会以同样的方式被漏第二次;手写的顶层指南(`docs/protocol-upgrade-guide.md`、
`docs/upgrading-to-11.md` 等)也因此在内。扫描文件数 219 → 360。

`docs/audits`、`docs/handoff`、`docs/plans` 用 #4915 的 `SKIP_PATHS` 机制按路径排除。
它们是有日期的一次性过程记录 —— 某一天写下的、关于仓库当天状态的审计/交接/计划,
没有任何一段是以「照这样写」提供给读者的。把它们纳入等于让两个月前的 handoff 永久
受今天的 lint 约束,而那种红只有两条出路:改记录(等于伪造史料),或者晚一场争论之后
照样加豁免。脚本注释写明了这是**永久豁免、不是待办**,判断线是「这份文档现在是否在教
你怎么写 metadata」,不是「它是否在 docs/ 下」。

纳入时全仓零违规,现在纳入是零成本 —— 这正是纳入的最佳时机。双向证明折进了常驻
`--self-test`:`docs/adr` 里的裸字面量必须判红,**同样内容**放进三个豁免目录必须保持绿。
两个方向各自单独成立时都会被一个方向错误的范围满足,所以两半一起断言。

纯工具链改动,不发布任何包。
