---
"@objectstack/plugin-approvals": patch
"@objectstack/service-analytics": patch
"@objectstack/cli": patch
---

Four readers of `FieldSchema.reference` gated the carrier with a truthiness test and then **propagated** it. `FieldSchema.reference` is declared an optional **string**, so the answer a reader owes for a carrier it cannot read is absence — and one of these four did worse than lose the information, it invented a name for it:

```
out.push({ key, reference: String(f.reference) })   // -> reference: '[object Object]'
```

Each site now reads the carrier through the one arbiter, `referenceCarrierOf`, and catches its refusal **at the site** — so the reader answers absence and reports, instead of aborting. That is the deliberate difference from `@objectstack/objectql`'s cascade seams, which let the same refusal propagate: those assert something positive about the schema on a write path, while these four are best-effort display and diagnostic readers whose own failure handling would have turned one unreadable field into a much wider loss.

- **`@objectstack/plugin-approvals`** — `resolveLookupFields`. The stringified carrier was handed on as an object name to `engine.find()`, where it could never resolve and the failure was swallowed by the caller's `catch`. The field is now left out of the inbox display enrichment and logged; readable targets are unaffected. It is dropped rather than carried with an absent target because the sole consumer uses `reference` as the object name and has nothing to do with an entry carrying none.
- **`@objectstack/service-analytics`** — the ADR-0021 relationship → target-object resolver. An unreadable carrier became the joined table for a dataset's `include`; the resolver now answers `undefined`, which its existing fallback turns into the compiler's own refusal, plus one warning naming the field.
- **`@objectstack/cli`** — `os doctor`'s circular-dependency and unused-object checks, which put the carrier into a graph node and a name set. Both now report the unreadable carrier as a finding rather than skipping it, because "no circular references detected" and "defined but not referenced" are positive claims that an edge nobody could read cannot support. The same file's `collectViewObjectRefs` already narrowed its carrier this way.

`null`, `undefined` and `''` are absence, not a wrong shape, and still pass silently at every one of these sites — a field is allowed to name no target. Each site's absence answer and its readable-target answer are pinned alongside the refusal.

Upgrading: nothing conformant changes. A non-string `reference` is refused by `ObjectSchema.safeParse`, so a value in that shape only ever reaches these readers without having passed parse at all.
