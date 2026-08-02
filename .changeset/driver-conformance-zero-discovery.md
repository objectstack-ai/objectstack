---
---

test(drivers): a conformance run that discovers zero drivers is a failure, not an OK (#4646)

`scripts/check-driver-conformance.mjs` discovers driver packages from disk under a
hardcoded `DRIVERS_DIR`. `listDir` swallows ENOENT and returns `[]`, and all three
invariants iterate the discovered set — CONSUMED over `drivers`, RECONCILED over
`LEDGER` (empty since #4405, the intended steady state), CLASSIFIED not over drivers
at all. So a stale `DRIVERS_DIR` produced `OK — 0 covered cell(s)` and exit 0.

CI never had this exposure: `lint.yml` runs `pnpm check:driver-conformance`, which is
`--self-test && audit`, and the self-test carried a driver-discovery assertion. The
false green was on the bare `node scripts/check-driver-conformance.mjs` the script's
own header documents as a usage.

Two things were wrong with leaving the guard there. It read
`drivers.length >= 3 && drivers.includes('driver-sql')` — a hardcoded name and count
inside the one script whose stated rule is that drivers come from disk and are never
listed, so both needed hand-editing on the next driver added or package moved, which
is precisely when the guard earns its keep. And its failure text ("discovers driver
packages from disk") named neither `DRIVERS_DIR` nor the stale path, leaving whoever
tripped it to find that themselves.

DISCOVERED is now a fourth invariant in `audit()`, and the message names the directory
it searched. The self-test drives the invariant in both directions instead of standing
in for it, and asserts nothing about which drivers exist.

The case-set axis cannot rot this way and is left alone: `CASE_SETS` is a declared
expectation, so a vanished `spec/src/data` fails CLASSIFIED's reverse direction with
one error per case-set. The driver axis is disk-discovery with nothing declared to
reconcile against — that asymmetry is why zero was reachable on one axis and not the
other, and it is what DISCOVERED supplies.
