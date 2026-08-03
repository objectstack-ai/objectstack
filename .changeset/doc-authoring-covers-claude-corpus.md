---
---

chore(scripts): `check:doc-authoring` 的扫描范围加入 `.claude`,并把范围接线折成常驻 `--self-test`。

这条检查只做一件很窄的事:在 ` ```ts ` / ` ```tsx ` 围栏代码块里匹配
`export const X: <16 个 factory 域之一>[Input] = {` 这种绕开 `defineX()` 工厂的裸
metadata 字面量(#2035 / ADR-0059)。它管的是代码样例的正确性,不是文风 —— 所以
「已发布文档的写作规范是否适用于内部 agent 文件」这个顾虑对它并不成立。

`ROOTS` 此前是 `['skills', 'content']`,即**顶层** `skills/`。而 `.claude/`
(skills、agent 定义、workflows)是 agent 每个会话都会加载并照抄的语料 —— 脚本自己
的文件头写着 *Skills are the corpus AI authors from, so a bad sample there is worse
than one in app code*,这句话对 `.claude/` 只会更成立。范围写 `.claude` 而非
`.claude/skills`,下一个子目录加进来时自动被覆盖。

两处配套:

- `.claude/worktrees/`(并行 agent 的 per-task worktree 落点,`.gitignore` 已声明)
  进新的 `SKIP_PATHS`。walker 是 `readdirSync` 不是 `git ls-files`,`.gitignore`
  拦不住它,不排除就会走进整个仓库的副本,报出与本分支无关的违规。
- 新增 `--self-test`:在临时目录里用真实 walker 从真实 `ROOTS` 走一遍,断言
  `.claude/**` 进得去、`.claude/worktrees/**` 进不去。`.claude` 下当前含 ts 围栏
  代码块的文件为 0,加进 ROOTS 后门禁照样是绿的 —— 而「加对了」和「加了仍然扫不到」
  从外部看一模一样(#4690 / #4804 / #4835 / #4868 / #4890 同族)。自检把这条反向
  证明变成常驻断言,而不是一次性验证。

纯 tooling,不发版。扫描文件数 215 → 219(新增的 4 个 `.claude` markdown),现存
文件零新增违规。
