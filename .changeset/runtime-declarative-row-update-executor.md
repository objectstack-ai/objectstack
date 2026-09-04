---
"@objectstack/runtime": minor
---

feat(runtime): the platform action route executes the declarative row-level `operation: 'update'` action (#14092)

The spec half (#15077) made `operation: 'update'` + `patch` parse; nothing performed the
write, so an authored update action reached the action route with no handler and collected
the registry's loud not-registered answer. It now performs the write.

`POST /api/v1/actions/<object>/<action>/<recordId>` — and the MCP `run_action` bridge, through
the same shared executor — performs exactly ONE data-plane update of the current record:

- **As the caller.** The write carries the caller's own `ExecutionContext`, never the
  `isSystem`-elevated context a `type: 'script'` BODY runs under. There is no author body here
  to trust, so the data plane's own gate is the only gate — the object's permissions, its hooks
  and its validations fire exactly as for a user edit, and their refusals reach the caller with
  their own `code` and `status`. This consumes the `runAs: 'user'` direction ruled on #14010; no
  `runAs` key is added.
- **A caller who cannot read the row is refused before anything is written** (404
  `RECORD_NOT_FOUND`, the platform's one existence-non-disclosing envelope), by consuming the
  caller-scope load's verdict rather than re-deriving it from the stamped `record.id` — the
  #14143 class: a swallowed load must never become an implicit grant.
- **The write is `{ ...patch, ...collectedParams }`** — static values under the dialog's, so a
  param of the same name wins. Nothing else from the action is merged, and the ADR-0104 D2 param
  contract still bounds what the wire can add.
- **No current record ⇒ a located refusal**, never a silent no-op: no `recordId` on the route or
  in the body, an action addressed at the object-less key, or an empty write bag each answer 400
  naming the action and the fix.
- **`undoable: true`** returns `undo: { type, objectName, recordId, undoData, redoData }` — the
  prior values of exactly the fields written, `null` for a field the row did not carry, so the
  existing Undo readers can restore. The three remaining `UndoableOperation` keys (`id`,
  `timestamp`, `description`) stay the client's.
- `visible` is deliberately unread here: it is a per-record renderer predicate, and the
  authorization is the point above.

`operation` is read BEFORE `type` at every reader, so the HTTP door and the MCP bridge agree:
`isHeadlessInvokableAction` now accepts a declarative update (it has neither `target` nor `body`
by construction), `headlessActionTypeError` hands it no client-side-type prescription, and
`summarizeAction` reports `operation` and `requiresRecord: true`.

Unchanged: a handler-less `type: 'script'` action WITHOUT `operation` still gets today's
not-registered 404 — the script path is not widened.
