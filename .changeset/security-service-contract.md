---
"@objectstack/spec": minor
"@objectstack/plugin-security": patch
"@objectstack/rest": patch
---

feat(spec): publish `ISecurityService` — the `security` service surface becomes an enforced contract

The `security` service registers seven cross-package methods (`getReadFilter`,
`getReadableFields`, `resolvePermissionSetNames`, `explain`, and the three
audience-binding suggestion calls) but had no contract in
`@objectstack/spec/contracts`. Consumers duck-typed it, and each one invented its
own fallback for a missing method or an "empty" answer — with more consumers
arriving, that is a drift surface.

`ISecurityService` now documents the surface, and both ends are typed against it
so it is **enforced rather than declared**: `plugin-security` assigns its
registration to `ISecurityService` (a renamed, dropped, or re-typed method fails
that build), and the REST layer resolves the service as a `Partial<ISecurityService>`
(so call sites must keep feature-detecting instead of assuming the full surface).

The contract makes explicit the one thing consumers cannot guess — that the
methods do **not** share a failure convention:

- `getReadFilter` fails **CLOSED**: a resolution failure yields a deny filter
  matching zero rows, never `undefined`. `undefined` means "no row restriction",
  and nothing else.
- `getReadableFields` fails **SOFT**: `undefined` means "no answer, use your own
  projection", while `[]` is authoritative and means "no field is readable" —
  opposite instructions that a consumer must not conflate.

Typing the producer immediately caught one real discrepancy, fixed here:
`getReadFilter` declared `Promise<Record<string, unknown> | null | undefined>`
while every return path yields a filter or `undefined` (`filter ?? undefined`
normalizes the null away). The dead `| null` is removed, so "no restriction" has
exactly one representation. Type-level only — no runtime behaviour changes.
