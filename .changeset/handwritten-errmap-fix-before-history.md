---
'@objectstack/spec': patch
---

Reorder the three hand-written `unrecognized_keys` error maps so the fix is read before the explanation (#6416, applying #5955's ruling).

`strictVisibilityError` (`shared/visibility.ts`), `strictWidgetAnalyticsError` (`ui/dashboard.zod.ts`) and `strictTenancyError` (`data/object.zod.ts`) are independent `$ZodErrorMap` functions rather than `strictUnknownKeyError` call sites, so #5955's reorder of the shared template did not reach them and #5593's `strictObject` migration cannot either. Each reproduced the exact shape #5955 was filed against: a non-actionable explanatory sentence sitting between the offending key and the prescription that fixes it, which on the single-line renders several consumers use (`os validate`'s `• where: message`, CI logs, `validateFlowTriggerReadiness`) pushed the fix out of the part an author actually reads.

Every message now emits front matter (which key is wrong) → every fix channel (the `visibleWhen` alias pointer; the ADR-0021 dataset / objectui-quarantine / #5022 drill branches; the per-key `tenancy` tombstone bullets) → the explanatory sentence last. Nothing is deleted and nothing becomes conditional — each sentence is still emitted verbatim, once per message, and all seven message variants are byte-identical in length and character multiset to their previous spelling. No input changes acceptance: these maps only shape the text of an already-failing parse, and the `visibility.ts` alias tables are untouched.
