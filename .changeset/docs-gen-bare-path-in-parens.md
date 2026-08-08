---
"@objectstack/spec": patch
---

fix(spec): 参考页里写在括号中的裸源码路径重新成链接 (#6420)

参考页开篇那段模块描述由 `packages/spec/scripts/lib/file-description.ts` 渲染。其中
把 JSDoc 里裸写的 `*.zod.ts` 路径改写成站内链接的那一步,正则两端各挂着一个前后瞻
——「前面不是 `(`」和「后面不是 `)`」。这对前后瞻是 tokenizer 出现**之前**的产物,
本意是「别去动已经是链接目标的路径」:`](route)` 恰好把那个路径夹在这两个字符中间。
它从来表达不了这件事(前后瞻说不出「不在链接内部」,模块注释里写着),而 #6136 之后
它更是无事可做了 —— 成形的链接是独立的 `link` token,这一步只会看到 `text` token。

它**仍在**做的,是把作者自己写在普通括号里的每一个路径一并拒掉。那是散文,不是链接,
于是这些路径既没成链接也没成代码,以纯文本发布在三张参考页上:

- `references/automation/etl` —— `- **Enterprise Connector** (integration/connector.zod.ts) - …`
- `references/integration/connector` —— `- **ETL Pipeline** (automation/etl.zod.ts) - …`
- `references/shared/mapping` —— `- Integration connectors (integration/connector.zod.ts)` 与 `- External lookups (data/external-lookup.zod.ts)`

现在删掉这对前后瞻,它们原本想守的不变量交还给 tokenizer 守。读者可见的变化就是上面
四处从纯文本变成可点的站内链接,路由分别指向 `/docs/references/integration/connector`、
`/docs/references/automation/etl`、`/docs/references/data/external-lookup` —— 三条都
对应真实存在的页面。

放宽的**实测**半径就是这四处,别无其他:在修好的生成器上重跑 `gen:docs`,231 个产物
里 3 个文件、4 行发生变化。渲染成链接的前提没有放宽 —— 目标没有页面的路径照旧回退成
代码段,所以括号位置永远不会产出 404。
