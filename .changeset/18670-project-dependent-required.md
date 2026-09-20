---
"@objectstack/spec": minor
---

**BREAKING (published artifact narrows)** — `packages/spec/json-schema/**` now states the cert/key pairing rule on SSL driver configuration, so a validator reading the published files stops answering PASS on a half-configured client certificate the platform then refuses (#18670 item 2, the third of the ruling's four named arms).

Clause-②: yes (narrowing)

One named pattern joins the closed list, and only one:

- **`dependentRequired` — "whenever this key is present, those keys must be present too"**, emitted as JSON Schema's own `dependentRequired`. `SSLConfig`'s rule that a client certificate and its private key are provided together is precisely `dependentRequired { cert: ['key'], key: ['cert'] }`, so the file now states it.

**The rows retired, by name.** `packages/spec/dropped-refinements.baseline.json` goes from 201 entries / 553 sites to **200 entries / 551 sites**:

| row | before | after |
|:---|:---|:---|
| `data/SSLConfig` | `sites: [""]` | **deleted** — the schema drops nothing now |
| `data/SQLDriverConfig` | `sites: ["", "sslConfig"]` | `sites: [""]` — the `sslConfig` site closed |

2 sites closed, **0 sites added anywhere**, and the ledger diff is deletions only. `data/SQLDriverConfig`'s remaining `""` site is its own separate rule — "`sslConfig` is required when `ssl` is **true**" — which judges a VALUE rather than key presence, is `if`/`then` rather than this arm, and stays dropped and annotated as `x-dropped-refinements`.

**⛔ Not a behaviour change, and no document the runtime accepts becomes refused.** The arm is EXACT rather than approximate: a key absent from a JSON object is the only way for its value to read `undefined`, and `dependentRequired` triggers on presence, so a key present with any JSON value — `null` included — arms its dependency exactly as the predicate's `!== undefined` does. Measured over a 10,368-document corpus across both affected schemas: the runtime verdict vector is byte-identical before and after (lit control — weakening the dependency map to one direction moves 96 documents), and of the 36 documents the published files stop accepting, **zero** are documents the runtime accepts. Across the whole published tree, 1530 of 1532 files are byte-identical; the two that move gain `dependentRequired` and lose the matching `x-dropped-refinements` row.

**The list stays CLOSED.** `packages/spec/src/shared/refinement-projection.ts` declares the vocabulary and builds each predicate from its own declaration — the dependency map is read once and used by both the published keyword and the enforced rule — so the two cannot name different keys. A refinement outside the list stays unprojected and keeps its annotation. `propertyNames` / `not` for banned keys remains untaken: the tree carries no candidate whose rule is mechanically derivable, so no arm was constructed for it.

**Two mechanism repairs ship with it**, both invisible in the published output and both load-bearing from this arm onward. The detector's verdict was reached per NODE while refinements are per CHECK, so a node carrying a declared arm beside an undeclared rule read `projected` outright and the undeclared rule reached neither the ledger nor the annotation; `projected` now requires every check on the node to be declared, and the generator reports partially-stated sites on their own line. And the generator and the detector each passed the projection `override` for themselves — dropping it on the generator side alone left every site reading `projected` behind a green ledger while the published file silently went wide — so both now reach `z.toJSONSchema` through one shared call with no argument left to forget.

<!-- adr-0087: not-required (no-migration-prescription) Nothing an author can write is removed, renamed or re-spelled: no spec key, no export and no config field changes, and the accepted set of metadata documents is byte-for-byte what it was. What changed is a machine-readable DECLARATION catching up with the runtime it always described, so there is nothing for `objectstack migrate meta` to rewrite and no stored representation to convert. -->
