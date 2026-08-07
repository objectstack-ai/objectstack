---
"@objectstack/lint": patch
---

fix(lint): `object/missing-name-field` 认 `nameField`、不再把已退役的 `titleFormat` 当作 name 面(#6108)

`object/missing-name-field` 的谓词从来不读 `obj.nameField`,却仍然采信 `obj.titleFormat`:

```
hasNameField = !!obj.primaryField || !!obj.titleFormat || fields.some(name-like)
```

净效果是同一个包里两条规则互相矛盾。`validate-record-title.ts` 把每一处 `titleFormat`
声明都报成 `title-format-retired`,并按 **ADR-0079** 指示作者迁移到 `nameField`
(`titleFormat` 是 render-only 模板,服务端既不能返回也不能查询);而共享的
`objectTitleCompleteness`(`@objectstack/spec/data`)判定标题面时也从不读它。于是:
**照平台自己的迁移建议把 `titleFormat` 换成 `nameField` 的对象,反而多得一条
"records will display as raw IDs" suggestion;守着已退役的键不动的对象反而干净。**

下游实测(hotcrm main,`@objectstack/* 17.0.0-rc.3`):6 处命中里 4 处是误报,
四个对象——`crm_campaign_member` / `crm_event_attendee` / `crm_contract` /
`crm_forecast`——都显式声明了 `nameField`;只有两个 line-item 对象是真命中。

本次修正:

- 谓词补读 `nameField`(ADR-0079 的规范主标题指针),显式声明它的对象不再被告警;
- 摘掉 `titleFormat` 这一支。**只声明 `titleFormat`、没有 `nameField` 的对象因此会
  新得一条本规则的 suggestion** —— 这是刻意的翻转,不是回归:这类对象正是 ADR-0079
  要求迁移的那一批,`validate-record-title` 今天已经对它同时报
  `title-format-retired` 与 `title-unresolvable`。两条规则从此对同一个对象给出一致判断;
- `primaryField` 与 name-like 字段两支行为不变;
- 提示文案改为只点名作者真正能声明的面(`nameField` 与 name-like 字段),并新增 `fix` 提示
  说明 `titleFormat` 不算标题面 —— 读到旧文案的作者很容易顺手再写一个 `titleFormat`,
  又掉回同一个矛盾里。旧文案里的 `primaryField` 同时不再出现:该键在 `packages/spec` 中
  没有任何声明,`ObjectSchema.create()` 会以 `unrecognized_keys` 拒收它(实测,已立 #6326),
  提示不该向作者广告一个会被 schema 硬拒的键。谓词里的这一支保持不动。
