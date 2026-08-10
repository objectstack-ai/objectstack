---
"@objectstack/spec": patch
---

fix(spec): 参考页里写在同目录的裸源码路径不再以纯文本落地 (#6484)

参考页开篇那段模块描述由 `packages/spec/scripts/lib/file-description.ts` 渲染。它把
JSDoc 里裸写的 `*.zod.ts` 路径改写成站内链接,而这条机制的**两侧**过去都要求路径里
至少有一个目录段:改写正则的 `[\w-]+/` 分组是必需的,`build-docs.ts` 的
`sourcePathToDocsRoute()` 也要求那个斜杠、并把第一段读作分类名。

于是作者按最自然的方式引用邻居 —— 写 `auth.zod.ts` 而不是 `identity/auth.zod.ts` ——
两侧都匹配不上,既没成链接,也没回退成代码段,以**纯文本**发布在四张参考页上,共 9 处:
`api/realtime-shared`、`cloud/package`、`identity/identity`、`system/security-context`。

缺的从来不是正则,而是**上下文**:`build-docs.ts` 按分类遍历,自己知道正在渲染哪个目录,
却只把一个成员交给渲染方。现在 `FileDescriptionContext` 增加 `fromCategory`,由
`build-docs.ts` 传入,裸文件名在渲染方补全成 `<分类>/<文件>` 后再去解析 —— 与
`schemaHrefFrom(fromCategory)` 是同一道缝。补全放在调用方一侧是有意的:裸名不是身份
(#4696),`auth.zod.ts` 在多个分类下都存在,让解析器自己去全分类搜同名文件只会答出
目录遍历最后到达的那一个。

读者可见的变化是这 9 处:**5 处成为可点链接**(`api/realtime`、`api/websocket`、
`cloud/package-version`、`cloud/environment-package`、`system/encryption`),**4 处回退成
代码段**(`auth`、`audit`、`compliance`、`masking` —— 这四个邻居本就不存在,按 #6229
的规矩「目标没有页面就不发链接」)。纯文本是三种结果里唯一错的那种,现在一处不剩。

`sourcePathToDocsRoute()` 同时补上了它文档里一直声明、实现却没做的那一半:分类是真的
不等于页面存在。旧实现只校验分类,这在放宽之前侥幸成立(能匹配上的路径恰好都有页面);
放宽后那 4 个不存在的邻居会各产出一条 404 链接。现在按本次运行真正发出的页面清单判断,
全语料 216 条站内路由、437 个位置,无死链。
