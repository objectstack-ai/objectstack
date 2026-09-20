---
"@objectstack/spec": patch
---

`ActionSchema.undoable` — the published description now names the WRITTEN set, not `patch` alone (#19148).

**FROM** — "`operation: 'update'` is the declared form of that action — its `patch` names exactly the fields whose prior values are captured."

**TO** — "`operation: 'update'` is the one declared operation and the declared form of that action: what the undo captures is the prior value of EVERY field the action writes — the merged write bag, `patch` UNDER the collected `params`, not `patch` alone. An action with no `operation` declares no write set, so nothing anchors the capture there."

An `operation: 'update'` action writes two sources: the static `patch` AND whatever its `params` collect. On any params-carrying action, "exactly the `patch` fields" is a strict subset of what the action writes, so an Undo built to the old sentence restores part of the change and reports the action as undone.

- **Prose only — no schema change, no accept/reject outcome moves.** The same author input parses the same way before and after; `Clause-②: no`.
- **The executor already captured the union.** `executeDeclarativeUpdateAction` keys `undoData` off `Object.keys(data)`, `data` being `declarativeUpdateWrite`'s merged bag `{ ...patch, ...params }`. The sentence was the outlier, and the EXECUTOR CONTRACT doc block ~200 lines above in the same file already read "exactly the fields written".
- **One operation, one rule.** The `operation` enum carries exactly one member, `'update'` (`'delete'` and `'custom'` are refused with their reason), so the per-operation capture rule is a one-row rule and is written as one.
- The describe text renders into three generated reference tables (`ui/action`, `data/object`, `kernel/metadata-plugin`), regenerated here; the hand-written protocol page `content/docs/protocol/objectui/actions.mdx` carried the identical claim and is corrected in the same edit.
