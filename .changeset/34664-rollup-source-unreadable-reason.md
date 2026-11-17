---
'@objectstack/spec': minor
'@objectstack/lint': minor
---

feat(spec, lint): a permission set can acknowledge a meant roll-up read with `rollupSourceUnreadableReason`

Clause-②: yes (widening) — one new optional authorable key, `rollupSourceUnreadableReason` on `FieldPermissionSchema` (a permission set's `fields` entry); nothing that parsed before is refused
Metadata-protocol: added
Skills-docs: follow-up #34742

`security-rollup-source-unreadable` warns when a permission set reads a roll-up `summary` column over child data it cannot read. The pair is legal and often meant, but `os lint --strict` fails on any warning and there was no way to say so. Now the set's entry for the summary column can carry the reason: `fields: { 'crm_account.invoiced_amount': { readable: true, rollupSourceUnreadableReason: 'Service staff read account totals but not invoice rows' } }`. That one finding (this set, this column) is reported as an `info` note quoting the reason, so `--strict` passes; other sets, other columns and `security-rollup-source-row-scoped` are unchanged. The key is read only at authoring time; the runtime does not read it. A blank reason, and a reason beside `readable: false`, are refused at parse time.
