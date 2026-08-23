---
"@objectstack/service-datasource": patch
---

`os datasource introspect --primary-key` (and `POST /object-draft` with
`primaryKey`) now generates an object draft that compiles and parses (#11000).

The generator emitted a field-level `primaryKey: true` — into the definition
and onto the rendered field line. `primaryKey` is **not a key of the spec field
schema**, so the `*.object.ts` the review-before-commit flow handed the user was
refused by both instruments the file is annotated for:

- `tsc --noEmit` against `ServiceObject` — `TS2353: Object literal may only
  specify known properties, and 'primaryKey' does not exist in type …`;
- `ObjectSchema.safeParse` — `unrecognized_keys` at `["fields","<f>"]`.

This was the last reason the `opts.primaryKey` path did not build. With #10712's
namespace/`sharingModel` repairs already landed, **both** paths — `primaryKey`
set and unset — now clear `defineStack()`'s namespace check, the
`authoringRulesFor('build')` rule set, and `tsc --noEmit` over the rendered
source.

The introspected key is not discarded: it is preserved as a comment above the
`fields` block, naming the column(s) the draft was given as the key —

```ts
  // Remote primary key: order_id, line_no
```

— with the reason it is a comment rather than a field key, and an explicit
caveat that for a composite key some drivers report only the first column
(#10997), so the list is a lower bound rather than a verified complete key. A
table with no reported key gets no comment at all.

Per the maintainer ruling of 2026-08-22, an authorable spelling for a federated
object's remote key (`external.primaryKey: string[]` on the binding schema) is
**deferred, not rejected** — it returns as its own `packages/spec` change when
federated upsert has a live runtime consumer to justify the surface.
