---
"@objectstack/spec": major
"@objectstack/plugin-sharing": major
---

feat(spec)!: resolve the three cross-form dual-source names — ShareRecipientType, TransformType, suggestFieldType (#4539)

Three `dual-source-exports.baseline.json` rows where the two declarations
sharing a name did not even share a FORM (type vs const, or two unrelated
functions), so a wrong import-path pick had no shape overlap to hide behind
and failed far from the cause. Each judged against a three-repo import-level
scan (framework, cloud, objectui — the latter two contained zero references
to all three names). All three rows are deleted from the baseline.

**Renamed — `./contracts` `ShareRecipientType` → `RecordShareRecipientType`:**

Two live concepts shared the name. The security zod enum
(`user | team | position | unit_and_subordinates | business_unit`) is the
authorable sharing-RULE recipient vocabulary and keeps the name. The contracts
type describes a different thing — the `recipient_type` a `sys_record_share`
ROW may carry — and its claim to "mirror spec/security" had been false since
`group`→`team`/`guest` were retired there. Its member set is now aligned to
the storage-side gate it actually mirrors, the `SysRecordShare`
`recipient_type` select: `role` (never persistable, zero producers) is
replaced by `position`. Only `user` is enforced (and written) today;
`ISharingService.grant` keeps refusing every other value (ADR-0078).
Fix: `import type { ShareRecipientType } from '@objectstack/spec/contracts'`
(or from `@objectstack/plugin-sharing`, whose re-export is renamed in
lockstep) → `RecordShareRecipientType`; code that named the `'role'` member
was describing a value no row could ever hold — use the rule vocabulary
(`SharingRuleRecipientType`) if a role recipient was meant.

**Renamed — `./shared` `TransformTypeSchema` / `TransformType` →
`FieldMappingTransformSchema` / `FieldMappingTransform`:**

`./data`'s `TransformType` (the authorable import-mapping enum
`none | constant | lookup | split | join | javascript | map`) is the live
declaration and keeps the name. `./shared` exported `TransformType` as the
inferred type of `TransformTypeSchema` — a differently-shaped discriminated
union of transform CONFIG objects — with zero importers for either name in
all three repos. The shared pair is renamed (not just the alias deleted):
the docs generator derives `import type { X }` examples by stripping
`Schema` from each schema const, so an alias-less `TransformTypeSchema`
would have kept generating a reference to an export that no longer exists.
Fix: `TransformTypeSchema` → `FieldMappingTransformSchema`,
`import type { TransformType } from '@objectstack/spec/shared'` →
`FieldMappingTransform` (same shape); importers who meant the import-mapping
enum import `TransformType` from `@objectstack/spec/data`.

**Renamed — `./data` `suggestFieldType` → `suggestFieldTypeForSqlType`:**

The only function-kind dual-source. The two implementations were never forks
of one function — different signatures, semantics and return types:
`shared/suggestions.zod.ts` (kept on `.` / `./shared` under the original
name) is the typo-suggester for an invalid authored FieldType
(`(input: string) => string[]`, alias table + Levenshtein, feeds the zod
error map), while `data/type-compat.ts` is the deterministic SQL-column →
FieldType mapper for external-datasource drafts
(`(rawType, dialect?) => FieldType | undefined`, ADR-0015 §4.6). Same input,
divergent outputs — `('varchar(255)')` → `[]` vs `'text'`; `('text_area')` →
`['textarea']` vs `undefined`; `('int')` → `['number']` vs `'number'` — and
the wrong pick compiled wherever the result was only truthiness-checked
(`[]` is truthy). Behavioral divergence is now pinned in
`data/type-compat.test.ts`.
Fix: `import { suggestFieldType } from '@objectstack/spec/data'` →
`suggestFieldTypeForSqlType` (same signature); imports from the root entry
or `./shared` are unaffected.
