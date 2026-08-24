---
'@objectstack/lint': patch
---

`lintLivenessProperties` no longer tells authors a `planned` property is `dead`

`describe()` in `lint-liveness-properties.ts` only knew two verdicts
(`experimental`, everything else → `dead`), while the liveness ledger ships a
third: `status: 'planned'` (declared, and a consumer is being built against
it — contract-first, the opposite of `dead`). Every `planned` row fell through
into the `dead` branch, so the finding's own **message** told the author to
remove metadata the platform had asked them to write, while the same finding's
**hint** (when the row carried one) said the opposite one sentence later. Three
shipped rows hit this: `field.relatedListFilter`, `object.externalSharingModel`,
`translation.flows`.

`describe()` now has a third branch: `status === 'planned'` gets its own rule
id (`liveness-planned-property`, mirroring `liveness-dead-property` /
`liveness-experimental-property`'s advisory-only posture — nothing downstream
keys off these ids today) and its own message/default hint ("keep it — a
consumer is being built against this property", never "Remove it").

The ledger's `status` field is a documented vocabulary, not a Zod-enforced
enum — nothing rejects a ledger entry with an unrecognised status. `describe()`
previously graded any such entry `dead` silently; it now throws, naming the
offending status, so a ledger-authoring mistake (a typo, or a new status added
without teaching this file about it) fails loudly at test time instead of
mislabelling a finding.
