---
"@objectstack/spec": minor
---

feat(spec): the builder forces `required: true` on a `master_detail` reference under `controlled_by_parent` (#9138 — #8772 maintainer ruling, Direction 2)

**BREAKING** accept-face narrowing on the authoring builder, landing after the
v17.0.0 cut (the lockstep launch-window convention ships it as `minor`; the
prescription is registered under protocol major 18, where `os migrate meta`
users will look).

A `controlled_by_parent` object derives ALL of its record access from the
master its `master_detail` reference names (ADR-0055). A master reference that
is not `required` arms the worst measured failure shape: an insert may omit
the master FK, the row lands with a null FK that the derived read filter
(`masterFK IN (accessible master ids)`) can never match — unreadable by
everyone — and every later by-id write answers `422 MISSING_REQUIRED_FIELD`.
#8772 measured that only the security gate closed that shape while the
declaration surface accepted it.

`ObjectSchema.create()` now makes the unsafe shape impossible to newly
declare:

- an **omitted** `required` on a `master_detail` reference under
  `sharingModel: 'controlled_by_parent'` is **forced to `true`** in the
  emitted object;
- an **explicit `required: false`** there is **refused** with a located error
  naming the object, the field, the consequence and the fix — an explicitly
  authored contradiction is not silently rewritten (ADR-0032).

## FROM → TO

```ts
// before — parsed green; the null-FK trap stayed armed behind the security gate
export const InvoiceLine = ObjectSchema.create({
  name: 'invoice_line',
  sharingModel: 'controlled_by_parent',
  fields: { invoice: { type: 'master_detail', reference: 'invoice', required: false } },
});

// after — refused at build with the prescription; omitting `required` is fine
// (the builder emits `required: true` by construction)
export const InvoiceLine = ObjectSchema.create({
  name: 'invoice_line',
  sharingModel: 'controlled_by_parent',
  fields: { invoice: { type: 'master_detail', reference: 'invoice', required: true } },
});
```

**What stays accepted:** everything outside that one shape. Raw
`ObjectSchema.parse()` / `.safeParse()` — the path metadata at rest rehydrates
through — still accept the old shape unrewritten, so existing installs keep
loading; the security gate's derived enforcement stays; the lint rule
`relationship/master-detail-required` stays `warning` until its own v18
promotion (#9139). The 2026-08-15 survey measured the shipped first-party
surface at exactly 3 `controlled_by_parent` objects, all already
`required: true` — zero first-party migration.

<!-- adr-0087: registered cbp-master-detail-required-forced -->
