---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol): `getUiView` 的响应体不再多发三个未声明键,与 `GetUiViewResponseSchema` 对齐

`GET /ui/view/:object/:type` 由 `getUiView` 产出、REST 层 `res.json(view)` 裸发(不套信封、不校验)。它的声明是 `GetUiViewResponseSchema`(= `ViewSchema`),但实发 body 里的 `list.object` / `form.object` / `form.label` 三个键,`ListViewSchema` / `FormViewSchema` 这两个 `strictObject` 从未声明,实测 `safeParse` 直接 `unrecognized_keys` 判红。因为 `GetUiViewResponseSchema` 在全仓没有任何运行时读者,这处分裂此前没有任何断言看得见。

**FROM → TO**

```
FROM  { list: { type, object, label, columns, sort, searchableFields } }
TO    { object, list: { type, label, columns, sort, searchableFields } }

FROM  { form: { type, object, label, sections } }
TO    { object, form: { type, sections } }
```

- **迁移**:读 `object` 的消费者上移一层 —— `body.list.object` / `body.form.object` 改读 `body.object`。这是**相同的值换了层级**,不是删除:`ViewSchema` 一直在容器层声明 `object`(「Object this container binds to」),成员层那份本就是冗余副本。
- `form.label`(原 `` `Edit ${…}` ``)**不上移、直接摘除**:它是渲染串而非元数据,任何 view schema 都没有声明过它;标题由 UI 自行拼(调用方本就知道自己请求的是哪个对象)。`list.label` **不受影响** —— `ListViewSchema` 正式声明了 `label`,保持原样。
- 定级 **patch** 而非 minor/major:三键的消费面实测为零 —— `client-react` 的 `useView` 把 body 当 `any` 透传(`UseMetadataResult.data: any`),objectui 全仓 `meta.getView` 零命中(其 `getView(objectName, viewId)` 走的是 `client.meta.getItem('view', …)`,另一条通路)。无编译期破坏面,无类型改判。
- `packages/spec` **零改动**:本次是把实现修正到既有声明,不是改声明迁就实现。

**未验面**:`cloud` 仓未在本次验证范围内(按 #5540 口径如实标注)。若该仓有直接读 `body.list.object` / `body.form.object` 的代码,需按上面的迁移上移一层;`form.label` 的读者需自行拼标题。

常驻 pin:`packages/metadata-protocol/src/protocol.ui-view-response-conformance.test.ts` —— 用**生产端真实组装路径**(实调 `getUiView`)喂 `GetUiViewResponseSchema.safeParse`,而非手拼 fixture。反向验证已跑:恢复任一多发键 → pin 转红并点名该键。
