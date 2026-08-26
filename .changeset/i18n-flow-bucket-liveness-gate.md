---
"@objectstack/cli": patch
"@objectstack/lint": patch
---

fix(cli,lint): stop `os lint` demanding translation keys the liveness ledger warns authors for writing (#11624)

`os lint` computes i18n coverage and runs the authoring-rule registry in a
single pass over the same stack, and for the `flows` translation group the two
halves pointed opposite ways:

| the author does | which rule fires | what it says |
|---|---|---|
| omits `flows.*` from the bundle | `i18n/missing-flow` | the key is missing a translation for locale X |
| adds it (`os i18n extract` scaffolds it) | `liveness-planned-property` | the `flows` group is `planned` — nothing reads it |

Measured on one stack, one run: omitting produced **4** `i18n/missing-flow`
findings and 0 liveness findings; authoring produced 0 demands and **2**
`liveness-planned-property` findings ("sets `flows` but this translation
property is planned"). There is no per-rule suppression in `os lint`, only
`--skip-i18n`, which silences the entire `i18n/missing-*` family — so the
author's only escape cost them every other coverage signal. Under
`--i18n-strict` the demand side is an **error**, so a project could be forced
to author keys it is then warned for.

⛔ The warning is not the bug and is unchanged: no shipped screen-flow runner
reads the group, so a translated wizard string is stored and never shown — the
failure mode `validationMessages` was removed in 17.0.0 for. The premature half
is the demand.

**The fix.** `collectExpectedEntries` — the single definition of what is
translatable at all, shared by the coverage gate and the `os i18n extract`
skeleton — now leaves out any translation group the liveness ledger warns
authors for authoring. It reads that set from `@objectstack/lint`'s new
`authorWarnedProperties(type)`, which returns the very warn-map
`lintLivenessProperties` iterates, so the demand side and the warn side cannot
drift into disagreeing about the same keys again.

Two properties fall out of reading the ledger rather than switching on `flows`
by name: the bucket **turns itself back on** the day an objectui screen-flow
runner lands and the row flips to `live` (no flag, no follow-up edit), and any
future group that acquires an `authorWarn` is covered on the day it is marked
rather than re-opening this collision one group at a time. Today `flows` is the
only such group — pinned as an equality so a second one goes red instead of
shipping.

No other bucket changes: `objects`, `apps`, `pages`, `dashboards`,
`globalActions` and `metadataForms` are all `live` and are reported exactly as
before. `@objectstack/spec` is untouched — the `flows` row keeps `planned` +
`authorWarn: true`.
