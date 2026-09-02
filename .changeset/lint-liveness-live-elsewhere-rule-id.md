---
'@objectstack/lint': minor
---

`lintLivenessProperties` no longer crashes on the `live-elsewhere` verdict — and never tells an author to remove a key a sibling repo enforces

`describe()` in `lint-liveness-properties.ts` knew three verdicts
(`experimental`, `planned`, `dead`) and threw, loudly and by design, on any
other. #13483 then shipped the ledger's fifth status — `live-elsewhere`: dead
HERE by measurement, genuinely enforced in a sibling repo — and migrated
`manifest.runtime` onto it (its enforcer is the cloud marketplace publish
gate). Nothing taught `describe()` about it, so the day any `live-elsewhere`
row opts into `authorWarn: true`, `os lint` would raise that
shipped-ledger-integrity error instead of the advisory warning the author
should get. No shipped row carries `authorWarn` today, so this was a fuse
rather than a fire.

`describe()` now has a fourth branch. `live-elsewhere` gets its own rule id —
`liveness-live-elsewhere-property`, exported as `LIVENESS_LIVE_ELSEWHERE_PROPERTY`
beside `LIVENESS_DEAD_PROPERTY` / `LIVENESS_EXPERIMENTAL_PROPERTY` /
`LIVENESS_PLANNED_PROPERTY` and advisory-only like them — plus its own message
(`is enforced in a sibling repo, not here`) and its own default hint, which keeps
the property and points at the ledger row's `evidence` for the enforcer. It
deliberately does **not** reuse the `dead` branch: that is the #11384 lesson,
which is that verdicts imply OPPOSITE author actions, and "Remove it" is the
single most damaging sentence available about a key whose enforcement is real
and remote — deleting it tears out a live gate's input. The sentinel throw
stays for genuinely unknown statuses, with its enumeration of the known ones
updated.

The suite gains a coverage pin derived from the shipped ledgers rather than from
a hand-written list: every distinct `status` those ledgers actually carry must be
answered by `describe()` with a rule id of its own, or (for `live`, which reaches
`describe()` only through a ledger-authoring mistake) must still fail loud. A
sixth status now fails that pin by name instead of waiting for an author to trip
the sentinel.
