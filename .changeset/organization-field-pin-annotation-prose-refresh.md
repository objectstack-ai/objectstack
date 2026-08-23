---
'@objectstack/spec': patch
---

Refresh the `tenancy.organizationField` scope-pin annotation and its
`.describe()` in `packages/spec/src/data/object.zod.ts` — prose accuracy
only, no schema or behaviour change.

The #8778 scope-pin annotation (landed by #10999) said consumer 1 (audit
stamping) was "as of this annotation, still the only one wired up" and that
consumers 2 and 3 (the approval-row writer and the automation-run recorder)
were "sanctioned but not yet implemented". #10101's PR #11311 (merged
2026-08-23) landed both: `resolveRecordOrganizationField` was promoted to a
shared resolver in `@objectstack/metadata-core` (plugin-audit re-exports it
from its original path) and all three sanctioned platform-row writers now
call it. The annotation and the `.describe()` string are updated to name all
three live consumers; the pin's load-bearing property — "The ruling sanctions
exactly THREE consumers of this key, and no others", a fourth consumer needs
its own ruling — is unchanged and still stated verbatim.

No accept/reject behaviour change, no schema shape change, no new keys.
