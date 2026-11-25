---
'@object-ui/console': patch
'@object-ui/i18n': patch
---

fix(console): a partly failed bulk approve or reject in the Approval Center says why each row failed

Clause-②: yes (narrowing)
Metadata-protocol: none
Skills-docs: none — no page under `skills/` or `content/docs/` names the Approval Center's bulk-failure string or teaches overriding it

<!-- adr-0087: not-required (no-migration-prescription) the narrowing is one console string retired from the approvalsInbox locale namespace of @object-ui/i18n; no packages/spec schema, registered node type, stored row or metadata key names it, nothing a metadata author writes changes, and a host that overrode it has nothing to rewrite: its override is simply no longer shown -->

**BREAKING** for a host that overrides `approvalsInbox.bulkPartial`, listed under "Removed translation keys" below: it is retired in 19.0.0, and an override of it no longer applies.

A bulk approve or reject that partly fails used to show "3 succeeded, 2 failed: Quote A, Quote B": at most three record titles, and no reason. Each failed row now keeps its refusal's text, read the way the single-row Approve reads it: the server's `userMessage` (already in the decider's language) when the refusal carries one, else the page's line for the refusal (not allowed, already decided, no longer exists), else a generic "Action failed".

The error toast reads "N succeeded, M failed" and lists the first three failed rows, one per line, each as "title: reason". When more rows fail, the toast stays until dismissed and carries a "Show all (M)" action, which opens a dialog listing every failed row with its reason.

`@object-ui/i18n`: the `approvalsInbox` namespace gains `bulkPartialSummary`, `bulkFailureLine`, `bulkFailuresShowAll`, `bulkFailuresTitle`, `bulkFailuresBody` and `close`, in every locale pack.

Removed translation keys (approvalsInbox namespace of `@object-ui/i18n`, released in 18.6.0; no code reads it since the partial-failure toast became a summary plus per-row lines). It is removed from all eleven packs it shipped in, `ar`, `de`, `en`, `es`, `fr`, `ja`, `ko`, `pt-BR`, `ru`, `zh-Hans` and `zh-Hant`:

- `approvalsInbox.bulkPartial` (ar, de, en, es, fr, ja, ko, pt-BR, ru, zh-Hans, zh-Hant)

An override of this key no longer applies; delete it, or move its wording to `approvalsInbox.bulkPartialSummary` (no `{{which}}` hole: the failed rows are listed below the summary).
