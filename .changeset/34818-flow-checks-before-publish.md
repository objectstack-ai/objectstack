---
'@objectstack/spec': minor
'@objectstack/lint': patch
'@objectstack/metadata-protocol': patch
'@objectstack/rest': patch
'@objectstack/runtime': patch
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(flow designer): the publish checks show in the Problems tab and the publish drawer before the publish, worded for the builder

Clause-②: yes (widening: optional userTextLocales on GetMetaItemRequestSchema)
Metadata-protocol: added

Before, a flow's publish checks were seen only after the publish, as a toast that listed rule ids, machine names and English prose, and then disappeared.

- **The draft read carries what the publish would still report.** A flow draft read (`state: 'draft'`) now adds the publish gate's advisory findings to `_diagnostics.warnings`, next to the refusals it already carried. Each warning has the finding's user sentence in the reader's language. The REST door and the runtime dispatcher pass the request's locales, through a new optional `userTextLocales` on `GetMetaItemRequestSchema`. With no locales the sentence is English. `valid` does not change, and the drafts of other types read as before.
- **The sentences name what the builder sees.** `flow-decision-unconditional-branch` has user text in all 11 platform locales. It names the flow, the branch step and the paths by their labels, and says what the shape does to a run and how to fix it. The `approval-approvers-*` sentences now name the flow and the approval step by their labels instead of the flow's machine name and the node id. A step or flow with no label falls back to its id or name. The findings' `message`, `where`, rules and severities do not change.
- **The console shows them before the publish.** The designer's Problems tab already lists a draft's warnings, so the checks now appear there after each save, and clicking one selects its step. The pending-changes drawer lists each flow draft's checks under the flow's label, above Publish. A publish from the drawer or the designer, made after the checks were listed, ends with the toast's title line only. A publish the author did not review, such as one an AI surface performs, keeps the full toast.
