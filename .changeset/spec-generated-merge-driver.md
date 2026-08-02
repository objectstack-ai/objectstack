---
"@objectstack/spec": patch
---

build: 为生成物加 `merge=os-regen` 合并驱动,把「集合运算被打成文本冲突」的返工消掉 (#4675)

`packages/spec` 的生成物是排序数组与追加式登记表。两个 PR 各增删几行,语义上是集合并与集合差、完全可组合,git 却按三路文本合并报成需要人工解决的冲突 —— 2026-08-02 一个下午实测四次合并、九处冲突,**没有一次是真正的语义冲突**,每次的正确解法都是「丢掉两边、重新生成、重跑门禁」。

`.gitattributes` 现在把这些路径交给 `scripts/git-merge-regen.mjs`。

**驱动不做重算。** git 是在合并**过程中**按索引顺序调用 merge driver 的,那一刻工作区里还是合并前的源码:`packages/spec/spec-changes.json` 排在 `packages/spec/src/...` 之前,所以在驱动里跑生成器会读到缺了对方那半边改动的 `migrations/registry.ts`,写出一个自信而错误的产物 —— 比它取代的那个冲突更糟,因为冲突标记是可见的错误,而看起来合理的生成文件不是。改为**推迟**:驱动解析路径(不做文本合并、不留标记)并记入 `$GIT_DIR/os-regen-pending`,`pre-commit` 在产物重新生成之前拒绝提交。重算因此发生在合并后的完整树上 —— 唯一正确的时刻。

`check:generated --fix` 现在在 `dist` 比 `src` 旧时**拒绝**运行 `gen:api-surface`,而不再只是警告。陈旧 dist 下该生成器不会失败,它会写出一份缺失了上次构建以来所有新导出的、看似合理的 surface,并让 `gen:docs` 顺手为这个缺口棘轮一条基线豁免(#4687 实际发生过,只靠与 `main` 对比生成物才发现)。`--fix` 是唯一会**写入**的路径,所以是这个陷阱唯一不可幸存的地方。

只减不增的棘轮(`docs-import-surface.baseline.json`、`dual-source-exports.baseline.json`)与手写登记表刻意排除在外:重算一个只减不增的棘轮可能**放宽**它,等于把一条新豁免当作合并噪音洗进来。这些冲突仍然留给人看,逐条理由见 `scripts/regen-artifacts.mjs` 的 `NOT_DRIVER_MANAGED`。

驱动按 clone 注册(`pnpm install` 经 `prepare` 完成)。没注册的 clone 回退到 git 默认文本合并 —— 即 #4675 之前的行为,不是故障。`pnpm check:merge-driver` 双向核对 `.gitattributes` 与该表,并对真实 git 做端到端验证。
