---
'@objectstack/service-analytics': patch
---

`dimension-labels.ts` — the module header names the label-resolving option arm by the **property the resolver actually reads** (a declared, non-empty `options` list) instead of by the type name `select` (#18923).

Doc comment only; it is published in `dist/index.d.ts` and `dist/index.d.cts`, so an upgrading reader's editor hover changes. No behaviour, no export, no schema.

The header told the reader the arm was a type test:

```
 *  - **select** — grouped by the stored option `value` (e.g. `backlog`), but the
 *    user-facing text is the option `label` (e.g. `Backlog`).
```

The resolver in the same file never reads a type for it. All three decision points spell one predicate — `Array.isArray(meta.options) && meta.options.length > 0` — at `isLabelBearing`, at `resolveLabels` and in `resolveDimensionLabels`'s display pass; `type === 'select'` occurs zero times in the file, while the sibling `type === 'date'` arm shows the file does spell type tests where it means them.

Naming a type is wrong in both directions, which is why the replacement names the property rather than a longer type list:

- **It misses fields that do resolve.** `options` is optional on every field in the spec's field schema, so any field that declares one is resolved here whatever its type says.
- **It promises resolution for fields that carry none.** A free-input `tags` field may declare no options at all, and the display pass then leaves its stored value untouched.

This closes the divergence that opened when the same sentence in `content/docs/data-modeling/analytics.mdx` and `content/docs/ui/dashboards.mdx` was moved to the property reading: the documentation was corrected, and the header the next editor of this file reads first was left behind.
