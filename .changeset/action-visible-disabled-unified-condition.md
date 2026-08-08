---
"@objectstack/spec": minor
---

feat(spec): `ActionSchema.visible` / `disabled` speak one shape — `boolean | string(CEL) | {dialect, source}` (#5970)

An action's two condition keys accepted different vocabularies. `disabled` took
all three arms; `visible` had no **boolean** arm, so `visible: true` — the most
obvious thing an author can write, and a shape already present in stored
metadata — was a parse error on the spec side while objectui's `ActionDef`
accepted it and pinned it with tests.

Both keys now accept the same three arms, cheapest first:

| arm | example | meaning |
|:---|:---|:---|
| `boolean` | `visible: false` | the degenerate literal — settled at authoring time |
| `string` | `disabled: "record.status == 'closed'"` | CEL shorthand, normalized to the envelope at parse time |
| `{ dialect, source }` | `{ dialect: 'cel', source: '…', meta: { rationale } }` | the full envelope, for authorship metadata or a non-default dialect |

**Purely additive** — every shape that parsed before parses the same way, and
every shape that was rejected is still rejected (an empty CEL string, a number,
`null`, an envelope missing `dialect`, an envelope with neither `source` nor
`ast`, an unknown dialect). No migration, no ADR-0087 disposition: nothing an
author can write was removed or renamed.

The boolean arm is deliberately **not** normalized into
`{dialect: 'cel', source: 'true'}`. A literal survives as a literal so a
renderer can branch on it without standing up an evaluator, and `false` stays
statically greppable.

**Why unify rather than leave it.** An asymmetry between two keys that mean the
same *kind* of thing is a dialect nursery: it teaches every consumer to carry
its own widening, and each of those is a second de-facto contract (Prime
Directive #12). Console's `DeclaredActionsBar` was carrying exactly that as an
`(action as any).disabled` cast. This change is what lets #4075 step 3 derive
objectui's `ActionDef` from the spec schema and delete the casts.

**One new rejection, at the interaction with `requiresFeature`.** The
declarative feature-gate sugar lowers into `visible`, so it now meets two
literals it never could before, and boolean algebra decides them in opposite
directions:

- `visible: true` + `requiresFeature: 'x'` → the gate alone. `true && <gate>` IS
  `<gate>`, so spelling the default out explicitly lowers exactly like omitting
  the key.
- `visible: false` + `requiresFeature: 'x'` → **parse error**. `false && <gate>`
  is `false` whatever the flag says, so the gate could never take effect and the
  declaration is inert on arrival — the parses-clean-changes-nothing shape
  ADR-0078 exists to reject. The message names both exits: drop
  `requiresFeature` to keep it hidden, or drop `visible: false` to let the flag
  decide. This combination was unwritable before (the boolean arm did not
  exist), so no stored metadata can carry it.

`bulkActions[].visible` is unchanged and keeps the two predicate arms only — a
per-record eligibility predicate has nothing to say as a constant. Its
description no longer claims shape-identity with `action.visible`.
