---
'@objectstack/spec': patch
---

Four of this package's own gate checkers can no longer report a self-test that never ran as a self-test that passed.

`check-exported-any.ts`, `check-dual-source-exports.ts`, `check-error-code-provenance.ts` and
`check-browser-reachable-entries.ts` each dispatched on `--self-test` with no battery roster, no floor and no
verdict handshake, so "every case held" and "the cases never ran" printed the same line. Measured on this
package rather than inherited from the sibling that started this programme: deleting one name from
`check-exported-any.ts`'s red-leg fixture list de-registers one of its two type-half detection pins, and the run
still prints its verdict byte-identically and still exits 0.

Each of the four now carries all three pieces, copied from the landed precedents and never imported, so every
self-test still runs standalone:

- a frozen `SELF_TEST_BATTERIES` roster — battery name to minimum case count — with each case registered against
  the battery most recently opened, registration first in the assertion sink so the floor asserts REACH;
- `SELF_TEST_BATTERY_FLOOR`, the roster's own size, so deleting an entry cannot take its floor with it;
- a module-level verdict flag set after the verdict line prints, and a dispatch that refuses a self-test which
  returned without reaching it — in three of the four, control used to fall through to the real audit, which on a
  built tree prints its own green line and exits 0.

What each gate says about the tree is unchanged: no detector, scan surface, ledger, baseline or verdict text of
the audit path moves. The verdict line of each self-test now also reports the registered case count and battery
count, because a printed count is evidence and the floor is the proof.

No published file changes — `packages/spec` ships `dist`, `json-schema`, `liveness`, `prompts`, `llms.txt`,
`README.md`, `src/**/*.zod.ts`, `CHANGELOG.md`, `api-surface`, `api-surface-declarations` and
`spec-changes.json`, and this diff touches none of them; the four files live under `scripts/`, which is not
shipped.
