---
"@objectstack/spec": minor
"@objectstack/runtime": patch
"@objectstack/service-i18n": patch
---

fix(i18n)!: `/i18n/labels/:object/:locale` emits the entry shape it declares —
and stops discarding `help`/`options` (#3847)

`GetFieldLabelsResponseSchema` has always declared each label as an object:

```ts
labels: z.record(z.string(), z.object({
  label: z.string(),
  help: z.string().optional(),
  options: z.record(z.string(), z.string()).optional(),
}))
```

Both serving surfaces emitted `Record<string, string>` — a bare label per field.
A client typed against `GetFieldLabelsResponse` read `labels[field].label` and
got `undefined`, because the value was the string itself. The SDK's type was
right the whole time; the servers were wrong.

The cost is not only the type mismatch. `FieldTranslationSchema` carries `help`
and `options`, bundles populate them, and the endpoint threw them away. objectui
needs exactly those — its `spec-translations.ts` transform reads `label` **and**
`options` (as `fieldOptions.<obj>.<fld>.<value>`) — and gets them by pulling the
whole bundle from `/i18n/translations/:locale` and resolving client-side. The
per-object endpoint could not have served it even if it wanted to: the data was
being dropped at the emit site.

Fixed at that emit site, `resolveObjectFieldLabels`, which both surfaces already
share as of #3833 — so one change covers both. `help` and `options` are attached
only when non-empty: an `options: {}` would claim a field has translated options
and hand back none, and a `help: ''` would erase a caller's source help text.
Fields with no non-empty `label` are still omitted entirely, which is what lets
`ResolvedFieldLabel.label` be a required string.

**The response schema is unchanged** — this moves the implementation onto the
contract, not the contract onto the implementation. Generated docs are
byte-identical for that reason.

`placeholder` is deliberately left out. `FieldTranslationSchema` has it and the
response schema does not, so emitting it would be widening the contract rather
than satisfying it — and adding an optional response field later is additive and
non-breaking, whereas guessing now is not.

The regression guard is the part worth keeping: a test that builds the response
body from the shared helper and parses it with `GetFieldLabelsResponseSchema`.
Nothing had ever put the emitted value and the declared contract in one
assertion, which is precisely why a bare string could sit under an object schema
unnoticed. Third and last of the declared ≠ enforced gaps on this endpoint
family, after #3676 (request filters no server read) and #3833 (a derivation
scanning a retired dialect).

BREAKING: `labels[field]` is now `{ label, help?, options? }` rather than a
string. No consumer in this repo or objectui read it — objectui never calls this
route, and in-repo use is the SDK method plus URL-shape tests — so the practical
blast radius is nil, and this is the cheap moment to align it.
