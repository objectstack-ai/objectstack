---
'@objectstack/spec': patch
---

fix(spec): `os migrate meta` guidance for the `driver-*`, `kernel-*` and `system-*` migration entries states each lesson in words instead of citing tracker numbers

Clause-②: no

The ADR-0087 semantic entries of the `driver-*` family (the driver query-argument
narrowings, the inert capability bits, the SQL driver's unresolvable-column and
cross-row upsert refusals, and the retired Turso config keys), the `kernel-*` family
(preview mode, and the kernel duration keys that now carry their unit in the key name)
and the `system-*` family (the system duration keys renamed under the same rule) are
printed by `os migrate meta` as the header, `why:` and `verify:` lines of a manual
change. Their text sent the reader to issue-tracker and decision-batch numbers — some
of which no longer resolve — for what a ruling, measurement or fix had decided; it now
says what was decided, in the sentence being read. ADR ids are kept.

Text only: no entry id, `surface`, `from` / `to`, conversion or matching logic changes,
and the chain rewrites exactly what it rewrote before. The generated migration registry,
`spec-changes.json` and the protocol upgrade guide carry the same text.
