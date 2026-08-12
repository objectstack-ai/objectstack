---
"@objectstack/verify": minor
"@objectstack/cli": minor
---

fix(verify): `--rls` reported 0 HOLES over a probe that could not reach the class it claims to prove (#7685)

`objectstack verify --rls` exercises one invariant — **you cannot mutate what you
cannot see** (#1994). It reported `0 HOLES` on both example apps. Neither number
was evidence.

**The probe was answered by the OBJECT gate, not by record scope.** The persona
was a bare `signUp()` member holding no object grants, so
`checkObjectPermission` refused with 403 before the row-level gate was ever
consulted — and the runner banked that 403 as `rls-consistent`. Measured on the
stock showcase: **11 of 13 "consistent" verdicts were the object-gate 403**, and
only 2 were a record-scope 404. On those 11 objects no platform regression could
have produced `rls-hole`, so their green was unfalsifiable by construction.

**A skip read as a pass, and it cascaded.** One `showcase_account` auto-record
400 skipped that object and every object with a required relation to it — 8 of
23 objects skipped — while the summary line still said `0 HOLES`.

## What changed

- **The probe persona is now the one the class needs**: object read+edit on every
  declared object, narrowed by an owner policy authored `operation: 'select'`
  only, registered at boot (`rlsProbeSecurity`) so its policies are actually on
  the resolution path. That is deliberately the authoring shape that WAS the hole
  (#7665), so every object of every verified app is now a live regression guard
  for the by-id write-scope derivation.
- **Reachability is measured, not assumed.** Before probing an object the runner
  asks whether the persona can list it at all; a 403 is reported as
  `probe-blocked` — a distinct status that is never a pass — instead of being
  recorded as a consistent verdict.
- **An unsatisfiable create no longer cascades.** When the app's own validation
  rejects the derived record, the runner adopts an existing row as the probe
  target, so the object is probed and its dependents keep their master.
- **The report distinguishes PROVEN from NOT-PROVEN.** `RlsReport.summary` gains
  `proven` / `unproven` / `probeBlocked`, `RlsReport.unproven` lists every object
  the run did not exercise with its reason, `RlsReport.probe` names the persona,
  and the formatted output prints an explicit "this run is not a clean bill of
  health" line whenever anything went unproven.
- **A degraded probe fails the run.** If the persona cannot be provisioned the
  report says so and `verify` exits non-zero, rather than quietly probing with an
  ungranted member and reporting success.

## Measured, before → after

| | showcase | crm |
|:--|:--|:--|
| before | 13 consistent (11 object-masked), 0 holes, 2 member-visible, **8 skipped** | 4 consistent (all object-masked), 0 holes, **2 skipped** |
| after | **20 of 23 PROVEN**, 0 holes, 3 unproven | **6 of 6 PROVEN**, 0 holes, 0 unproven |

The remaining 3 are honestly unprovable by this runner: one object has no
plain-text field to mutate, two are read-only federated objects.

The new green is falsifiable: ablating the #7665 write-scope derivation in
`plugin-security` — while leaving the #1994 pre-image re-read fully in place —
turns 16 of the 20 proven showcase objects into `rls-hole` and exits 1.

## No behaviour change outside the verifier

This is tooling: no runtime, spec or enforcement path is touched.
`runRlsProofs`' existing four-argument call shape still works, and consumers that
only read the report gain fields rather than losing any.
