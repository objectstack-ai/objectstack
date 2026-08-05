---
---

fix(showcase): `showcase_contact` 声明 `fieldGroups`,让视图注释承诺的自动分组成真(#5443)

`examples/app-showcase/src/data/objects/contact.object.ts` 的九个字段都写了
`group`(contact/work/status/notes),对象却没有声明 `fieldGroups`。按 ADR-0085 §5,
`deriveFieldGroupLayout` 只把 `group` 命中已声明 `fieldGroups[].key` 的字段归入分组,
其余一律落进末尾的未分组桶 —— 所以这九个 `group` 与完全不写 `group` 渲染结果相同,
`os lint` 也据此报了九条 `field-group-undeclared`。

而 `src/ui/views/contact.view.ts` 的头注释(`content/docs/ui/create-vs-edit-form.mdx`
引用的那份参考实现)写的是:手写的 `form`「镜像平台自动派生的结果」,「省掉它就能免费
得到等价的分组表单」。在没有 `fieldGroups` 的前提下这句是假的 —— 照抄示例的读者省掉
`form` 拿到的是一张平铺表单。这正是 Prime Directive #10 的推论(不要宣传运行时并不
提供的能力),只不过说谎的是示例自己的注释。

本次改动:① 给 `showcase_contact` 补上四个 `fieldGroups` 声明(label 与视图四个段落
一致);② 校准视图头注释 —— 点明派生以 `fieldGroups` 声明为授权来源,并如实写出省掉
`form` 后与手写版的两处差异(派生结果会在末尾追加平台注入的 `owner_id` 未分组段;
`columns: 2` 这类段落排版是表单视图的旋钮,分组声明不携带);③ `test/seed.test.ts`
新增用例,把「派生段落 == 视图手写段落(顺序与成员)」这条承诺本身钉住。

九条 `field-group-undeclared` 归零(484 → 475 warnings,无新规则)。`_sections` 派生
键集合不变(仍是 contact/work/status/notes 四键,与 #5438 已译的四键同名,walker 去重),
`scripts/i18n-coverage-baseline.json` 与 `supportedLocales` 均未改动。

仅改示例应用(`examples/app-showcase` 为 private 包),不发布任何包。
