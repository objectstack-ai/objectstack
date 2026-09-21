---
'@objectstack/lint': minor
---

`lintLivenessProperties` now reports a liveness ledger it could not read, instead of going silent.

`loadWarnMap` returned the same empty map for two different facts: "this metadata type's ledger classifies nothing as warn-worthy" and "there is no ledger". A missing `<type>.json` and a file whose JSON is broken both returned an empty map with no log, no throw and no other signal, so losing or corrupting ONE file under the `liveness/` directory `@objectstack/spec` ships switched every author warning for that type off in silence — indistinguishable from that type simply having no warnings.

The contrast that makes it a defect rather than a design sits one frame up: the DIRECTORY-level failure is loud by construction (the rule returns `[]` and everything depending on it goes red). Loud by directory, silent by file.

What changes for consumers:

- A new rule id, `LIVENESS_LEDGER_UNREADABLE` (`'liveness-ledger-unreadable'`), exported from the package root beside the four verdict ids. It is not a fifth verdict: the other four grade a property the ledger DID classify, this one says the classification never arrived, so a finding carrying it means no other finding about that metadata type can be trusted. Compare `f.rule` against the constant rather than retyping the slug. It cannot be silenced per finding: the CLI has no per-rule suppression, and `suppressWarnings` is a dashboard-widget key (`spec/src/ui/dashboard.zod.ts`) while this finding's subject is a ledger rather than an authored item, so there is nothing to carry it. The remedy is the one the finding's own hint names — repair or reinstall `@objectstack/spec`.
- `lintLivenessProperties` raises exactly one such finding per unreadable type, per run — never one per authored item — ahead of the walk's own findings, and keeps walking every type whose ledger IS readable. On an intact installation nothing changes: no ledger is missing, so no finding is added.
- A ledger that parses but is not a ledger (a bare `null`, an array, a scalar, or a document with no `props` record) is the same reported fault. Reading `.props` off a parsed `null` used to be a `TypeError` — a throw from a rule whose contract is that it never throws, through the one input an author cannot influence.

`authorWarnedProperties` still answers the empty set for a ledger it cannot read — a decision procedure returning a set has no way to report a failed read — and that is unchanged for a missing file and for broken JSON. One input does move: a ledger document that parses to `null` used to make it THROW, and it now returns the empty set like the other two. `os lint` runs both halves in one pass, so the run states the fault once rather than never.
