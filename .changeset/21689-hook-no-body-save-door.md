---
'@objectstack/metadata-protocol': minor
---

The runtime save door refuses every hook that carries no `body`, including one with neither a `body` nor a `handler`: a hook stored there ships with no code package, so its `body` is the only code it can run

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) A validity narrowing at one runtime write door over existing keys: no key of `HookSchema` or of any other metadata schema is removed, renamed or re-shaped, so there is no tombstone and nothing mechanical for `objectstack migrate meta` to rewrite. What `body` a refused hook should carry is authoring intent no conversion entry can decide. New saves are refused with the remedy; a row stored before this change keeps its bytes, and no stored row is re-saved (measured: `migrateStoredMetadata({ apply: true })` on a stored hook row with neither field reports it canonical, failed 0, and the bytes are unchanged). The census of writers through this door, taken first at `1db5322ba2`: Studio at the objectui pin (`ab18797215`, unchanged since the census of the handler-only refusal, which read its hook skeleton carrying a `body`); objectstack `examples/**` and `packages/qa/**` seed no `sys_metadata` hook rows (zero `type: 'hook'` items); `os meta register` forwards the author's own file and emits no hook of its own; the artifact, boot and install-local doors never call `saveMetaItem` for a hook (every call site in the tree saves a fixed type other than `hook`, or forwards an author's request: the REST and dispatcher `/meta` saves, `migrateStoredMetadata`, `duplicatePackage`). The only first-party bodies of this shape were test probes (seven suites), which now carry a `body`. Package duplication of a package holding such a row now reports that row as failed with this refusal (measured: copied 1, failed 1, the source rows' bytes unchanged). Hosted tenants and the cloud AI author were not measured. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id covers this rule and this diff adds none (not registered / already-registered); and the change narrows what a runtime write door accepts, not a runtime interface or a type surface alone (not runtime-interface-only / type-surface-only). -->

**BREAKING** accept-set narrowing at the runtime save door, shipped as `minor` under the repo's launch-window convention for breaking changes, the grade the same door's earlier refusals shipped with.

**One rule.** `saveMetaItem`, which `PUT /api/v1/meta/hook/:name` and the dispatcher's metadata save both call, now refuses every `hook` that carries no `body`. It already refused a hook whose `handler` names a function and that carries no `body`; that refusal is now one case of this rule, with the same envelope and the same message. The new case is a hook with neither field (or with an empty `handler`). Before this change the door answered 200 for it, the hook was served by name, the runtime skipped it at every re-sync (`skipping hook with unresolved handler`, in the server log only), and it never ran. The refusal is `VALIDATION_ERROR` / 400, in draft and in publish mode, before anything is stored or bound. It names the hook and prescribes a `body`.

**Before and after** (with `{ name: 'stamp_status', object: 'crm_note', events: ['beforeInsert'] }`):

- Before: 200 `Saved hook 'stamp_status'`, the row stored and served by name, and the hook never run.
- After: 400 `VALIDATION_ERROR`, naming `stamp_status`, and nothing stored.

**What still saves.** A hook with a `body`, with or without a `handler` beside it: the binder runs the body and never consults the name. A malformed `body` still gets the type schema's located `422 INVALID_METADATA`.

**What is unchanged.** `HookSchema` still accepts a hook with no `body`, because a build artifact carries a `handler` hook: `objectstack build` lowers an inline function to the hook's name and ships the function in the artifact's runtime module. A hook in an artifact or a `defineStack` config binds on its own door, which never reaches this one. `os validate` and `os build` are unchanged.

**Rows stored before this change.** They keep their bytes, nothing re-saves them, and the runtime skips them at every re-sync as before. A new save of one, a re-save included, is refused until it carries a `body`. Package duplication reports such a row as failed with this refusal; `migrate meta --stored` leaves it as it is. Delete stays open.

**The fix.** Give the hook a `body`: sandboxed JS (`{ language: 'js', source }`) or an expression (`{ language: 'expression', source }`). A hook that must run a package's own function belongs in that package's code, where its `handler` resolves.
