---
"@objectstack/spec": patch
---

fix(spec): 参考文档的模块标题改为声明式,`qa` 不再被渲染成 "Qa Protocol" (#5853)

`build-docs.ts` 过去是**猜**模块标题的:默认首字母大写,再对 `['UI', 'AI', 'API']`
这三个当初有人想到的缩写做全大写例外。`qa` 同样是缩写 —— `src/qa/index.ts` 自己的
文件头写的就是 "Quality Assurance (QA) Protocol" —— 但不在名单里,于是生成器单方面
把它降级成 **"Qa Protocol"**,一次发布到三处:分类页标题、`qa/meta.json` 里的侧边栏
标签,以及(#4759 把根索引纳入生成之后)`references/index.mdx` 的导航行与章节标题。

## 为什么不是把 `QA` 加进名单就完事

- `packages/spec/src/` 下有 **17** 个模块目录,由 `readdirSync` 在运行时发现 ——
  没有任何东西提醒作者在新增目录时去补名单。
- 这 17 个里 **4 个是缩写**(`ai`、`api`、`ui`、`qa`),名单覆盖了 3 个:在它唯一
  服务的那一类上,漏报率 25%。
- **任何门禁都不可能发现它。** `check:docs` 比对的是「生成结果 vs 已提交结果」,
  而一个错误的标题是**稳定的**,所以它永远是绿的。`Qa Protocol` 从 `src/qa/` 建立
  那天起熬过了每一次重生成,直到 #4759 把 14 个标题并排印出来才被人眼看见。

所以真正的缺陷不是「漏了一个缩写」,而是**猜出来的标题错得无法被发现**。

## 现在的形状

标题改为在 `scripts/lib/category-title.ts` 里逐个**声明**(`CATEGORY_TITLES`),并且
该表对磁盘上的目录是**全覆盖**的:没有兜底、没有推导,`resolveCategoryTitles()` 是
构造这张映射的唯一入口,双向缺口一律抛错。新增一个模块目录会让 `gen:docs` 直接失败
并指名道姓地告诉你补哪一行,而不是默默发布一个 "Iam Protocol"。这与旁边 `CATEGORY_BLURBS`
用了一个数据项的既有写法(`blurbCoverage` / `formatBlurbCoverage`,#4759)是同一套惯例
—— 标题只是最后一个还在靠猜的按模块数据项。

面向读者的变化:参考文档三处落点现在都读作 **"QA Protocol"**。
