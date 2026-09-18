---
"@objectstack/spec": minor
---

**BREAKING (published artifact narrows)** — `packages/spec/json-schema/**` now states the banned-key rule the tracing sampling filter enforces, so a validator reading the published files stops answering PASS on `{ "dialect": "cel" }` at `TraceSamplingConfig.composite[].condition` — the card's own worked instance of a published file saying yes to metadata the runtime refuses (#18670 item 2, the fourth of the ruling's named arms).

Clause-②: yes (narrowing)

One named pattern joins the closed list, and only one:

- **`banned-keys` — "no document may carry any of these keys"**, emitted as `propertyNames` with a `not` over the banned names. `TraceSamplingConfig.composite[].condition` is a structured filter of match criteria that refuses an object carrying `dialect`, because such an object is an expression attempt and this slot's expression arm was retired in 17.5.0. The published file now says so.

**The rows retired, by name.** `packages/spec/dropped-refinements.baseline.json` goes from 202 entries / 553 sites to **200 entries / 551 sites**:

| row | before | after |
|:---|:---|:---|
| `system/TraceSamplingConfig` | `sites: ["composite.element.condition"]` | **deleted** — the schema drops nothing now |
| `system/TracingConfig` | `sites: ["sampling.composite.element.condition"]` | **deleted** — the same node, reached through the parent |

2 sites closed, **0 sites added anywhere**, and the ledger diff is deletions only. Generator census after: 551 dropped across 200 published schemas, **357 projected** — 224 `non-blank-string`, 129 `required-one-of`, 2 `dependent-required`, **2 `banned-keys`** — 9 undecidable.

**⛔ Not a behaviour change, and no document the runtime accepts becomes refused.** The arm is EXACT rather than approximate: a JSON object's properties are exactly its own enumerable string-keyed ones and `propertyNames` judges exactly those names, so "none of the banned names is an own property" and "no property name is one of the banned names" are one sentence read from two ends. It is presence and never value — a banned key present with a `null` value is present on both sides. The accept set at the slot is **unchanged in both directions**: every document the runtime takes (`{}`, `{ "service": "api" }`, any filter carrying no `dialect` key) the file still takes, and every document the runtime refuses the file now refuses too — a `dialect`-bearing object of any shape, the CEL envelope included, since that arm is retired and nothing here revives it. Across the published tree, **1528 of the 1530 per-schema files are byte-identical**; the two that move gain the ban and lose the matching `x-dropped-refinements` row, and nothing else in either file changes.

**The list stays CLOSED.** `packages/spec/src/shared/refinement-projection.ts` declares the vocabulary and builds each predicate from its own declaration — the key list is read once and used by both the published keyword and the enforced rule — so the two cannot name different keys. The predicate judges OWN properties and never `key in value`: `in` walks the prototype chain, so a ban on a name `Object.prototype` carries would refuse `{}` itself while `propertyNames` accepts it, and that is a disagreement about a JSON document rather than an edge outside the domain. A ban over an OPEN set of names — every key starting with `$`, which is what `data/filter.zod.ts`'s normalized field condition refuses — is deliberately not this arm: its keys are a finite list, and a list that merely sampled an open set would be wider than the rule, so those sites stay unprojected and keep their annotation.

<!-- adr-0087: not-required (no-migration-prescription) Nothing an author can write is removed, renamed or re-spelled: no spec key, no export and no config field changes, and the accepted set of metadata documents is byte-for-byte what it was. What changed is a machine-readable DECLARATION catching up with the runtime it always described, so there is nothing for `objectstack migrate meta` to rewrite and no stored representation to convert. -->
