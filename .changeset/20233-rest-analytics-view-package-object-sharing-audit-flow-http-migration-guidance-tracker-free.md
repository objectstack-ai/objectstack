---
'@objectstack/spec': patch
---

fix(spec): `os migrate meta` guidance for the `rest-*`, `analytics-*`, `view-*`, `package-*`, `object-*`, `sharing-*`, `audit-*`, `flow-*` and `http-*` migration entries states each lesson in words instead of citing tracker numbers

Clause-②: no

The ADR-0087 semantic entries of the `rest-*` family (the retired OpenAPI 3.1 block, the
endpoint `handlerStatus` marker, the REST server's dead config keys and the REST plugin
durations renamed with their unit), the `analytics-*` family (the retired query envelope,
the unknown-key refusals on cubes, and the closed date-range vocabulary and two-bound
window), the `view-*` family (the filter value shaped by its operator and its array and
absent-value refusals, the retired view-management protocol, the page-size default and the
judged overlay `options` bag), the `package-*` family (the explicit all-tenants uninstall,
the retired unmounted contract-map entries and rollback response, and the strict wrapped
install body), the `object-*` family (the array `sort` on object blocks, the converged grid
`data`, the rule-array `defaultFilters` and the index unknown-key refusal), the `sharing-*`
family (the retired `SharingExecutionContext` type and the reconciled rule recipients), the
`audit-*` family (the audit-log action values no writer produced), the `flow-*` family (the
retry count, the decision-branch and edge refusals, first-match edge branching and blank
predicate slots) and the `http-*` family (the retired error counter and server runtime
vocabulary) are printed by `os migrate meta` as the header, `why:` and `verify:` lines of a
manual change. Their text sent the reader to issue-tracker, decision-batch and ruling-record
numbers — some of which no longer resolve, and some in another repository — for what a
ruling, measurement or fix had decided; it now says what was decided, in the sentence being
read. ADR ids are kept. Two entries of other families are corrected the same way:
`api-error-retry-after-unit-in-key` now dates the population ruling its clause describes,
and `inline-grid-column-currency-scale-refused` names its two currency rulings by date
instead of by record number.

Text only: no entry id, `from` / `to`, conversion or matching logic changes, and the chain
rewrites exactly what it rewrote before. One entry's `surface` (the header line of
`flow-edge-condition-evaluated-slot-source-required`) drops the two tracker numbers it
carried and names nothing else differently. The generated migration registry,
`spec-changes.json` and the protocol upgrade guide carry the same text.
