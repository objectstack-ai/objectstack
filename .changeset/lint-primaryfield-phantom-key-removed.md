---
"@objectstack/lint": patch
---

fix(lint): 摘掉 `primaryField` 这个幽灵键——两条规则不再把它当作标题面(#6326)

`primaryField` 在 `packages/spec` 里**没有任何声明**。实测(`17.0.0-rc.5` dist):

```
ObjectSchema.safeParse({ name: 'probe_obj', label: 'Probe', primaryField: 'code',
                         fields: { code: { type: 'text', label: 'Code' } } })
// => success: false
// => issues: [{ code: 'unrecognized_keys', keys: ['primaryField'], path: [] }]

ObjectSchema.create(/* 同上 */)
// => throws: ObjectSchema.create('probe_obj'): unknown key(s) — primaryField.
```

同一形状换成 `nameField: 'code'` 则 `safeParse` 通过。也就是说,这个键**从来不是可声明面**,
而三处消费者没跟上——两面同源,却各自有一个可达面:

- **文档面(作者会照做,当下活着的那一半)**:`skills/objectstack-data/SKILL.md` 是 AI 编写
  元数据时读的技能文档,它把 `primaryField` 明说成 `object/missing-name-field` 的合法逃逸口。
  照它写出来的对象在 `ObjectSchema.create()` 上被 ADR-0032「不静默丢弃未知键」的闸硬拒——
  **这是在教 AI 写出必然失败的元数据。**
- **规则面(判定永不成立)**:`data-model-rules.ts` 的 `!!obj.primaryField` 一支,以及
  `validate-semantic-roles.ts` 标题解析链里的那一项,对任何 schema 收得下的对象恒为 false,
  属于 #4984 家族的死支——看起来在保护什么,实际什么都判不到。

本次按维护者裁定 **remove,不 declare**(`nameField` 已是 ADR-0079 的规范主标题指针,
再立一个平行指针没有拉力,且与 Prime Directive #7「One Zod source per metadata type」相悖):

- `data-model-rules.ts`:`object/missing-name-field` 的谓词收敛为
  `!!obj.nameField || fields.some(name-like)`;
- `validate-semantic-roles.ts`:规则 (d) 的标题解析链收敛为
  `[nameField, displayNameField]`(`displayNameField` 实测可声明,保留);
- `skills/objectstack-data/SKILL.md`:该规则的表述改为只点名作者真正能声明的面——
  `nameField` 与 name-like 字段(并列出这七个名字)。

**零 `packages/spec` 改动,不需要迁移:`primaryField` 从来不是可声明键,写了它的对象在
schema 上本来就发布不了,所以没有任何能工作的 app 会因此回归。** 行为上唯一的变化是:
一个只靠 `primaryField` 充当标题面的对象,现在会新得一条 `object/missing-name-field`
的 suggestion(severity 为 suggestion,不失败命令)——而这类对象本就通不过 `ObjectSchema`。
真正的修法是改声明 `nameField`。
