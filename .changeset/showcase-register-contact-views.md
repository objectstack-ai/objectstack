---
---

fix(showcase): 把 `ContactViews` 注册进 `objectstack.config.ts` 的 `views:`（#5420）

`examples/app-showcase/src/ui/views/contact.view.ts` 声明了「create form ≠ edit
form」的整套元数据（四个具名段落的默认 `form` + 稀疏的 `formViews.create` +
列表上的 `addRecord.formView: 'create'` 绑定），barrel 也导出了它 —— 但 config
第 23 行的具名 import 与第 196 行的 `views:` 数组都漏了它。`views:` 背后没有目录
扫描，CLI 读的就是这个数组，所以这份元数据编译通过、类型通过、lint 干净，却既进
不了运行栈，也进不了任何静态门。后果是 `nav_contacts` 渲染的是派生默认表单而不是
作者写的那份，而 `content/docs/ui/create-vs-edit-form.mdx` 正把这个文件当作活的
参考实现引用。

注册之后随之可见的 5 个 zh-CN 覆盖键（`_views.list.label` 与
`_sections.{contact,work,status,notes}.label`）在同一提交内补齐译文，棘轮基线
`scripts/i18n-coverage-baseline.json` 与 `supportedLocales` 均未改动。

仅改示例应用（`examples/app-showcase` 为 private 包），不发布任何包。
