---
'@object-ui/types': patch
'@object-ui/plugin-grid': patch
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

fix(console): a per-record bulk flow action counts a refused record as refused, with its own message, and stacks no refusal notice

Clause-②: yes (seat ruling: the published `@object-ui/types` `ActionResult` gains a member; L1-a owes a lane-keep L2 review)
Metadata-protocol: none

The published `@object-ui/types` adds two optional members, `ActionResult.refusal` and `ActionContext.reportsRefusal`. Nothing existing is narrowed.

A list view's selection bar can run a `type: 'flow'` action once per selected record. A run that ended on an `end` node with `outcome: 'refused'` answers `200` with `status: "refused"` and a `refusalMessage`. Before this change the bulk result counted such a record as succeeded ("Succeeded 3 / 3"), and one refusal dialog opened on top of the result showing a single record's message, so the other refused records' reasons were lost.

- The result now counts refused records apart: "Succeeded 1 / 3 · Refused 2". Each refused record is listed with the sentence the flow wrote for it. A refused record has no Retry and is not written to the error CSV: re-running it would get the same answer. When a failed record is retried and the action refuses it, it moves to the refused list.
- No refusal dialog opens during a bulk run. The same action launched from a row menu still opens its Close-only refusal notice, unchanged.
- `ActionResult.refusal` (`{ message }`) is set by the console's flow launch on a run that ended `refused`, beside `success: true` and `handedOff: true`. A caller that counts outcomes reads it as refused, never as done.
- `ActionContext.reportsRefusal` is passed for one dispatch through `ActionRunner.execute`'s `callContext`. A caller that lists refusals itself sets it, and the console's flow handler then opens no notice of its own.
