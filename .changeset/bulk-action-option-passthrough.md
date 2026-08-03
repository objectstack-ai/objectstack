---
"@objectstack/spec": minor
---

fix(spec): stop silently stripping widget config off a bulk-action param option (#4001)

`BulkActionParamSchema`'s `options[]` entry is now `.passthrough()`, matching its
parent. **Behaviour change, loosening only**: keys other than `label` / `value` on
an option used to be *removed at parse* and are now preserved. Nothing that parsed
before stops parsing, and no key changes meaning — an authored option simply keeps
what it was written with.

Concretely, this used to happen without a warning:

```ts
// authored
options: [{ label: 'In Review', value: 'in_review', color: '#8B5CF6', icon: 'eye' }]
// parsed, BEFORE
options: [{ label: 'In Review', value: 'in_review' }]
```

`color` and `icon` are not decoration the renderer ignores. objectui's
`bulkParamToField` spreads every option entry into the field metadata
(`packages/plugin-grid/src/components/bulkParamToField.ts:131`), where the widget
vocabulary is `SelectOptionMetadata` (`packages/types/src/field-types.ts:288`) —
`color`, `icon`, `disabled` and `visibleWhen` beyond the declared pair, and read
(`option?.color`, `packages/fields/src/index.tsx:1089`). So the strip deleted
config that would otherwise have rendered, on the authoring side, invisibly.

Nothing to migrate. If you dropped option colors/icons because "the spec ate them",
they work now. The strictness ledger's prose already described this level as
deliberately open while only the parent schema said so in code; the code now says
it too, which is the part a machine can check.
