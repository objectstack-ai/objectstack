---
'@objectstack/platform-objects': patch
'@objectstack/runtime': patch
'@objectstack/objectql': patch
'@objectstack/spec': patch
---

fix(platform-objects): 超预算后台 seed 期间不再空库自证 —— 一次启动不再跑两套契约

#4769 已把 ADR-0104 的空库自证从 `kernel:ready` 挪到 `app:seeded`(本次启动自身数据的结算点),但保留 `kernel:ready` 作为「从不 seed 的内核」的兜底。剩下的窗口是这两个钩子**到达顺序可以颠倒**:`AppPlugin` 的 inline seed 超出软预算(`OS_INLINE_SEED_BUDGET_MS`,默认 8s)后转入后台,于是 `kernel:ready` 先到、兜底自证在 seed 仍在写的时候签发证书并把闸门翻到 strict——同一次 seed 运行的后半段撞上前半段从未见过的契约。showcase 冷启(`OS_INLINE_SEED_BUDGET_MS=1`)实测:自证发生在 +0.470s,seed 结算在 +3.617s,窗口 3.147s。

现在两个钩子都先问一句「本次启动自己的 seed 落定了吗」,任一处报告仍有未结算的 seed 源就不签发。`app:seeded` 同样受这道检查约束——多 config app 的 bundle 会每个 app 触发一次,第一次并不是本次启动的结算点。

新增 `seed-settlement` 契约(`@objectstack/spec/contracts`)承载这个信号,而不是让 platform-objects 去嗅 runtime 内部的 `seed-datasets` 服务:那个数组的存在只能说明「seed 源存在」,永远说明不了「已经落定」,而这两件事之间的差正是本 bug 的整个窗口。runtime 在选择分支之前先声明 seed 源,并在写入真正结束的同一刻结算它。

**multi-tenant 与 `skipSeedData` 的 ADR-0104 姿态(2026-08-06 裁定,#4795)**:这两种部署会注册 seed 数据但在启动时并不写入(前者按 org 在 `sys_organization` insert 时重放,后者是 `os migrate` 的只读规划启动,#3917),`app:seeded` 永不触发。它们的姿态是**启动时不自证,等 `os migrate … --apply` 在真实扫描的证据上落笔**——由同一个判据自然得出,不需要单独分支。这是答案而不是缺口:在启动那一刻断言一次尚未发生的 per-org 重放不含违规值,正是 #4769 的同一个错误、只是引信更长;而停在 warn-first 是可恢复的方向,随时可由 `os migrate value-shapes --apply` / `os migrate files-to-references --apply` 关闭。

`@objectstack/objectql` 侧只更新了 #4769 撤销机制的注释:「后台 seed 收尾晚于签发」不再是它要兜的场景(已在源头关闭),它对 `os dev` 热重载 seeder、运行期 marketplace 安装以及 lax 开关仍然有效。
