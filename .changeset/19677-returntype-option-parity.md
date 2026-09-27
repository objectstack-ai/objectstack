---
"@objectstack/spec": patch
---

The object designer's quick-add grid no longer offers two formula `returnType` members that `FieldSchema` refuses (#19677).

`FieldSchema.returnType` declares four members — `number`, `text`, `boolean`, `date`. The `fields` repeater in `object.form.ts` declared an inline `options` list of **six**, adding `datetime` and `currency`. An author who added a formula field from the object designer and picked Datetime or Currency wrote a value the parse rejects: the select is populated from that inline list, nothing reconciled it against the enum, and the refusal arrived later from the save door naming a key the author never typed.

The control is narrowed to the four declared members. This is a pull-back to a spelling that already existed in this package twice, not a decision about what a formula may return:

- **The enum is unchanged** — `FieldSchema.returnType` accepted exactly these four before this change and accepts exactly these four after it. No authorable value is removed, because neither `datetime` nor `currency` was ever accepted; what is removed is an offer with nothing behind it.
- **The sibling control already spelled it correctly.** The field designer's own `returnType` select in `field.form.ts` carries the same explicit four-member list. The object designer was the lone divergent carrier; three now agree, counting the published reference doc.
- **The producer side agrees with the enum too.** Authoring stamps `returnType` from the inferred CEL type, and that inference is typed `number | text | boolean | date | unknown`, so there is no path by which the platform stamps `datetime` or `currency`.

Whether any stored field carries `returnType: 'datetime'` or `'currency'` today is not measured here and is unaffected either way: the parse that refuses those values is the one that already ran.

The regression test derives its expected set from `FieldSchema` at runtime rather than hard-coding four strings — a test pinned to literals rots exactly the way this defect did — and judges the offer at value level: every offered value must survive a full parse on a formula field.
