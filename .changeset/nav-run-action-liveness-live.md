---
"@objectstack/spec": patch
---

**Liveness-ledger verdict:** `app.navigation[].runAction` moves `planned` → `live`, and drops its `authorWarn` (#10068).

The declared deep-link slot (`ObjectNavItemSchema.runAction`, #4848/#7253) now has a real consumer in a shipped shell, so authoring it changes runtime behaviour. **What changes for authors:** setting `runAction` no longer raises the liveness advisory that told you the auto-run does not fire from this declaration yet. Nothing about the schema, the accept set, or the authoring-time validation changed — `defineStack`'s cross-reference walk and lint's `validate-action-name-refs` nav arm still reject a name that resolves to no defined action, exactly as before.

The row carries **two** evidence pointers, not one, and the split is the point:

- **`producer`** — objectui `packages/layout/src/NavigationRenderer.tsx`: defines `NAV_RUN_ACTION_PARAM` (the wire name's one definition) and applies `withRunAction` inside `resolveHref`'s object branch, on the **list landings only** — never the `recordId` branch. It *writes* the deep link and runs nothing.
- **`evidence`** — objectui `packages/app-shell/src/hooks/useNavRunAction.ts`: the single read-once/consume-once consumer, wired generically at `ObjectView.tsx` (every object list) and behind the entitlement gate at `EnvironmentListToolbar.tsx`.

A renderer-only pointer would have said the slot is live because something *emits* it; what makes the key live is that a shell *consumes* it, and that lives in `app-shell`, not `layout`. Both were read at the `.objectui-sha` pin `9a3daf8`, which postdates the consumer's merge (objectui#5216 via objectui PR #5354).

⚠️ **Recorded on the row: enforcement is not consumption.** The published `@objectstack/spec@17.0.0` does **not** enforce the `runAction` × `recordId` exclusivity — the `objectNavTargetExclusivity` refinement exists on `main` but is outside the GA build — and it accepts `runAction: ''`. That is the merged-but-unpublished window, not a defect. The consequence worth carrying: objectui's list-surface-only precedence and its empty-string-is-absent handling are **load-bearing rather than defensive**, because the pinned schema refuses neither input for it. Generalising: merged upstream ≠ published ≠ pinned downstream, and unlike a missing key, a missing **refinement fails silent** — the input is let through and the consumer proceeds.
