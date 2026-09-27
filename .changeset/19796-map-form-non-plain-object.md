---
'@objectstack/spec': minor
---

fix(spec): strict `defineStack` refuses a `Set`, `Map` or other non-plain object for a map-form collection key instead of accepting it as an empty collection

**BREAKING** — `defineStack` (strict, the default) now refuses a class of input it used to accept with every authored entry silently missing.

`normalizeMetadataCollection` turns the map form of a collection (`permissions: { rep: { … } }`) into an array before the schema parse. It read any `typeof 'object'` value as that map form, so a `Set`, a `Map` or a `Date` went through `Object.entries`, which yields `[]` for them. The parse then saw a valid empty array: `defineStack({ manifest, permissions: new Set([{ name: 'rep', … }]) })` was accepted with `permissions: []` — the author's grants gone, no error, no warning. This reached every map-form key (every entry of `MAP_SUPPORTED_FIELDS`: `objects`, `apps`, `permissions`, `flows`, `agents`, …).

| the key's value | before | after |
| :--- | :--- | :--- |
| a `Set`, a `Map`, a `Date` | accepted, the collection is `[]` | refused, `STACK_SCHEMA_INVALID`, `status: 422`, zod issue at the key (`expected: 'array'`) |
| a class instance | read as a map of its own fields | refused the same way |
| an object literal, `Object.create(null)`, a plain object from another realm | normalized (key → `name`) | unchanged |
| an array | passed through | unchanged |

Only a plain object is the map form; every other value reaches the parse unchanged and is refused there, at the key where it was written. `normalizeMetadataCollection`, `normalizeStackInput` and `normalizePluginMetadata` (public `@objectstack/spec` exports) now return such a value unchanged instead of `[]`.

The one-line fix: author the key as an array (`[...set]`, `[...map.values()]`) or as a plain-object map (`Object.fromEntries(map)`).

No code is added to the ADR-0112 ledger and no export changes: the refusal is the strict parse's existing `STACK_SCHEMA_INVALID`.

<!-- adr-0087: not-required (no-migration-prescription) Nothing authorable moves: no spec key, Zod schema, export, config field or stored metadata shape is added, removed, renamed or re-spelled. A Set, Map or class instance is not a serializable metadata document, so no stored or authored source file carries one and objectstack migrate meta has nothing to rewrite; what narrows is the normalizer's reading of in-memory values that the map form never declared. -->

Clause-②: no (narrowing)
