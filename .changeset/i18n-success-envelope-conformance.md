---
"@objectstack/spec": minor
"@objectstack/runtime": patch
"@objectstack/service-i18n": patch
---

fix(runtime,i18n)!: `/i18n/locales` answers in one shape — plus the
success-envelope conformance gate that found it

Follow-up to #3676 / #3833 / #3847. Those three were each a body that did not
match the schema declaring it, and each survived a green suite because **every
test asserted the emitted body against a hand-written literal**. Comparing
output to a literal proves the code does what the test author believed; it
cannot prove the code does what the contract declares. Nothing had ever put the
emitted value and the declared schema in the same assertion.

This adds that assertion as a suite — `i18n-success-envelope.conformance.test.ts`
in `runtime`, the missing success-path twin of service-i18n's
`error-envelope.conformance.test.ts` and the same pairing storage got in #3689.
Every `/i18n` success body is parsed against `BaseResponseSchema` and against
the schema `plugin-rest-api` names for that route (`responseSchema:
'GetLocalesResponseSchema'`, …), imported rather than restated.

**It found a fourth gap on its first run.** `GET /i18n/locales` passed
`getLocales()`'s raw `string[]` straight through the dispatcher, while
`GetLocalesResponseSchema` declares `{ code, label, isDefault }[]` — and
service-i18n, the *other* provider of this identical route, already emitted
descriptors. One endpoint, two shapes, decided by which plugin mounted it, with
the dispatcher's form contradicting the SDK's own `GetLocalesResponse` type.

That is the same split #3833 found in the field-labels derivation, one route
over, and it happened for the same reason: two surfaces, one mapping, kept
twice. So the mapping is now shared as `toLocaleDescriptors` in
`packages/spec/src/system/i18n-resolver.ts`, next to `resolveObjectFieldLabels`,
and both surfaces call it. `label` is the locale code — no display-name source
exists in the tree and the schema requires the field; inventing an ICU
display-name table here would be a product decision, not an implementation
detail.

The gate was verified the same way #3833's was: the fix was reverted and the
suite confirmed to fail on it —

```
locales body does not match its declared schema:
  [{"expected":"object","code":"invalid_type","path":["locales",0],
    "message":"Invalid input: expected object, received string"}, …]
```

— rather than merely passing once written. Five existing tests pinned the bare
`string[]`; they now assert on `.map(l => l.code)`, so the codes stay pinned
while the shape is owned by the schema.

BREAKING: `GET /i18n/locales` served by the dispatcher now returns
`[{ code, label, isDefault }]` instead of `['en', …]`. Callers on the
service-i18n mount already received this shape, and the SDK's published
`GetLocalesResponse` type has always described it, so this ends a divergence
rather than starting one.

Worth generalizing beyond `/i18n`: `plugin-rest-api.zod.ts` already carries a
`responseSchema` name on essentially every route (29 declarations across 28
handlers), so the route → declaring-schema mapping needed to run this check
repo-wide exists today and is unused.
