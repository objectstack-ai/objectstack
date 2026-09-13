---
'@objectstack/metadata-protocol': patch
---

The seed-tenancy backfill's organization probe records the operator channel as is — an empty one included — instead of the placeholder `'unknown error'` (#17167)

`packages/metadata-protocol/src/migrations/seed-tenancy-backfill.ts` had one site left
that did not follow the rule the rest of the file follows. Where the other four
`operatorFacingErrorText` calls record the helper's return value as is, the
`sys_organization` probe spelled `operatorFacingErrorText(e) || 'unknown error'`, so a
backend that failed WITHOUT saying anything was recorded as having said
`'unknown error'` — words no backend produced, in a field an operator reads to find out
which probe failed and why.

**Measured before and after**, driving `backfillSeedTenancy` at each site in that file
with the same three empty-channel shapes (a thrown `''`, a thrown `[]`, an `Error` whose
`name` and `message` are both empty) and with `new Error('boom')` as the control:

| site | before | after |
|---|---|---|
| split probe → `result.detail` | `''` | `''` |
| **organization probe** → the warning's `organizationProbeError` | **`'unknown error'`** | **`''`** |
| duplicate-list probe → the warning's `error` | `''` | `''` |
| stamp → the warning's `error` | `''` | `''` |
| counter merge → the warning's `error` | `''` | `''` |

The control records `'boom'` at every site in both columns.

**Why this was not a one-line deletion.** The placeholder was carrying two jobs and only
one of them was a record: the site also read `organizationProbeError === ''` as "the probe
did not fail", which is how a failed probe is kept out of the benign `no-organization-yet`
branch (#9261 — unknown is not zero). Deleting the placeholder and putting nothing in its
place was measured: a thrown `''` then reports `no-organization-yet` and warns about
nothing, while the control still reports `skipped-ambiguous-organization`. So the failure
fact moved into the TYPE — `organizationProbeError` is `string | undefined`, `undefined`
means the probe answered, and every string, empty or not, is a failure. The text is then
free to say exactly what the backend said.

**What does NOT move.** No status value changes for any input: an organization probe that
throws still reports `skipped-ambiguous-organization`, whatever its channel holds, and
`SeedTenancyBackfillStatus`, `SeedTenancyBackfillResult` and every exported signature are
unchanged. This probe's text never reached the returned result in the first place — it is
carried only by the warning this migration logs (measured: the control text appears in
`result.detail` at the split-probe site and appears nowhere in the returned object at this
one).

**One operator-visible detail beyond the text.** The warning's structured field is now
absent when the probe answered and present-but-empty when it failed silently, so "empty"
and "there was no failure" stay distinguishable in the stored line — the one job the
placeholder was doing that a reader could have depended on. The sentence in the same
warning drops its parenthetical rather than filling it in: `the sys_organization probe
FAILED, so the count above is "unknown"` when the backend said nothing.
