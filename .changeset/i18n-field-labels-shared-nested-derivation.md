---
"@objectstack/spec": minor
"@objectstack/runtime": patch
"@objectstack/service-i18n": patch
---

fix(runtime,i18n): the dispatcher's field-labels route reads the bundle shape
producers actually write — one shared derivation (#3833)

`GET /i18n/labels/:object/:locale` served through the dispatcher returned
`{ labels: {} }` for every provider. Its derivation scanned for flat
`o.<object>.fields.<field>` keys:

```ts
const prefix = `o.${objectName}.fields.`;
for (const [key, value] of Object.entries(translations)) { … }
```

That dialect was retired by #3778 — no producer has ever written it, and a real
bundle's top-level keys are the `TranslationData` groups (`objects`, `apps`,
`messages`, …), so the prefix could not match anything. 4cca74c fixed the
identical derivation in `service-i18n` and did not reach the dispatcher's copy.

This is not a rare fallback. `getFieldLabels` is optional on `II18nService` and
**nothing implements it** — not `memory-i18n`, not `file-i18n-adapter` — so the
dedicated-method branch both surfaces check first is dead in production and this
derivation is the only path there is. Any stack served by the dispatcher (the
AppPlugin in-memory provider auto-registered for stacks declaring translation
bundles) got an empty map, indistinguishable from "this object has no translated
labels": nothing errored, nothing warned.

Worse than the class it was found next to. #3676, which prompted the check,
ignored a declared filter and returned the full bundle — a correct superset. This
returned nothing and said it was fine.

The derivation now lives once, as `resolveObjectFieldLabels` in
`packages/spec/src/system/i18n-resolver.ts`, alongside the other resolvers that
read `TranslationData`. Both surfaces call it. Keeping a copy each is precisely
how one got fixed and the other did not; the next bundle-shape change now has one
place to land. Fields carrying no non-empty `label` stay omitted rather than
emitted blank — partial translation is the normal state, and callers merge this
map over their source labels, where a `''` would erase them.

### The tests were fiction on both sides

The dispatcher's fallback test fed flat `o.contact.fields.first_name` keys and
asserted labels came back, so it passed on data that cannot occur while
production returned `{}` — the same failure mode as the client test retired in
#3676, which asserted a query string was built that no server read. It now feeds
the nested shape, and was confirmed to fail against the pre-fix code (`expected
{} to deeply equal { first_name: 'First Name', … }`) rather than merely passing
after it. The shared helper carries its own unit tests, including one pinning
that the retired flat dialect resolves to `{}`.

The same suite's mock also declared a `getFieldLabels` no shipped provider has,
and returned flat-dialect data from `getTranslations`; both now reflect what a
real provider does, with the divergence noted where it remains deliberate.

Not addressed here, filed separately: `GetFieldLabelsResponseSchema` declares
`labels` as `Record<string, { label, help?, options? }>`, but both surfaces emit
`Record<string, string>` — a third declared ≠ enforced gap in the same endpoint,
and a wire-shape change too breaking to fold into a correctness fix.
