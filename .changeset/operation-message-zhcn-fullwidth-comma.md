---
"@objectstack/spec": patch
---

fix(spec): punctuate the `zh-CN` Operation Message Catalog with the full-width comma (#12717)

Every `zh-CN` entry in `BUILTIN_OPERATION_MESSAGES` separated its clauses with
U+002C (the ASCII comma) while ending the same sentence with U+3002 (the
full-width period) — two punctuation systems inside one sentence. In Chinese
typography the half-width comma reads as a lapse rather than as a style, and
these are strings a business user reads in a toast.

The two surfaces genuinely sit together on one screen: an approval action's own
description renders full-width (`plugin-approvals`'
`zh-CN.objects.generated.ts`, U+FF0C / U+FF1F) while a refusal from the same
feature rendered ASCII.

Twelve U+002C across the nine `zh-CN` entries — the five situation keys
(`permission_denied`, `record_access_denied`, `record_change_not_allowed`,
`record_write_denied`, `approval_recall_not_submitter`) and the four
`delete_restricted*` variants — become U+FF0C. Nothing else moves: the U+3002
sentence finals were already correct, the two U+3001 (、) enumeration commas in
the `_required` variants are correct Chinese and stay, and the `en`, `ja-JP` and
`es-ES` rows are untouched.

Text-face only — no key, placeholder, wire code, status or accept/reject
behaviour changes. A deployment that overrides `errors.<messageKey>` through a
`translation` is unaffected; only the built-in default moves.
