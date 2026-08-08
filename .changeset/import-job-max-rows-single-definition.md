---
'@objectstack/rest': patch
---

rest 的异步导入行数上限改为直接读取 spec 的 `IMPORT_JOB_MAX_ROWS` 导出，不再自己声明一份同值字面量（#6535）。

**行为没有任何变化**：两处此前都是 `50_000`，改后仍是 `50_000`，上限、`413` 文案、拒绝边界全部不动。
这是一次一致性收敛，不是缺陷修复——因此按 patch 计。

收敛掉的是一处漂移面：`packages/spec/src/api/export.zod.ts` 的那份导出带着 TSDoc，会进
`content/docs/references/`，是这个上限的**对外说明**；而真正执行拒绝的是 `packages/rest`，
它此前读的是自己那份本地 `const`，两者之间只有一句 "mirrors spec" 注释相连。没有任何 gate
比较这两个数，所以把 spec 那份改掉、执行侧纹丝不动，全部检查依然全绿——文档说一套、系统做
一套，而 `413` 文案里内插的又是 rest 那一份，连报错都会自洽地说谎。现在一处定义、两处读点
（`maxRows:` 与 `413` 文案）同源。
