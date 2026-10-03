---
'@objectstack/plugin-sharing': patch
'@objectstack/plugin-audit': patch
---

Sharing refusals and log lines, and the audit write-failure line, no longer cite tracker numbers; each one states the decision behind it in words

Clause-②: no

Some strings these two packages show to administrators and operators pointed at an issue-tracker number for the reason behind them. The number goes; where the sentence did not already say what was decided, it now does.

- `@objectstack/plugin-sharing`: the orphan-sweep line for record shares says every share on a deleted record goes, whatever its source, so a reused record id cannot inherit it; the same line for share links says a share link is a bearer token, so a reused record id must not inherit it; the write-gate failure line says a failed lookup is a refusal, never an abstention, because an abstention would hand the row to the other write authorities, which may admit it; the authored-row-write probe line says only an app-authored row-level policy that positively admits the row may lift the sharing refusal; the hierarchy-scope line says the resolver contract makes a resolver fail closed on a missing organization. The two sharing-rule refusals (no active organization; deleting a platform-global rule) drop their citations, since each sentence already says why. The `OrphanSweepSubject.issue` member's doc comment now says the member carries that reason in words.
- `@objectstack/plugin-audit`: the missing-table fix in the audit write-failure line says that on a fresh `os dev` boot the table exists in the sibling telemetry file and not in the primary one, so look there before concluding it was never created.

Text only: no status, error code, field, route or control flow moves. A client or log filter that matches the old text (for example a tracker-number suffix) needs the new spelling.
