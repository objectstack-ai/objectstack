---
'@objectstack/metadata-protocol': minor
---

The runtime save door refuses a hook whose `handler` names a function and that carries no `body`: a hook stored there ships with no code package, so that name can never bind

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) A validity narrowing at one runtime write door over an existing key: no key of `HookSchema` or of any other metadata schema is removed, renamed or re-shaped, so there is no tombstone and nothing mechanical for `objectstack migrate meta` to rewrite. What `body` a refused hook should carry is authoring intent no conversion entry can decide. New saves are refused with the remedy; a row stored before this change keeps its bytes, and no stored row is re-saved (measured: `migrateStoredMetadata` records such a row canonical and writes nothing). The census of writers through this door, taken first: Studio at the objectui pin (`ab18797215`) creates a hook from a skeleton that carries a `body` and re-saves the body it lists (`ObjectHooksPanel`); objectstack `examples/**` and `packages/qa/**` declare no hook with a string `handler` (the only string `handler` there is a job's) and seed no `sys_metadata` hook rows; the platform checklist saves no such hook; the artifact, boot and install-local doors never call `saveMetaItem` for a hook (every call site in the tree saves a fixed type other than `hook`, or forwards an author's request: the REST and dispatcher `/meta` saves, `migrateStoredMetadata`, `duplicatePackage`). Package duplication of a package holding such a row now reports that row as failed with this refusal (measured). Hosted tenants and the cloud AI author were not measured. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id covers this rule and this diff adds none (not registered / already-registered); and the change narrows what a runtime write door accepts, not a runtime interface or a type surface alone (not runtime-interface-only / type-surface-only). -->

**BREAKING** accept-set narrowing at the runtime save door, shipped as `minor` under the repo's launch-window convention for breaking changes, the grade the same door's earlier refusals shipped with.

**One rule.** `saveMetaItem`, which `PUT /api/v1/meta/hook/:name` and the dispatcher's metadata save both call, now refuses a `hook` whose `handler` is a function name and that carries no `body`. A hook stored through this door ships with no code package, so it holds no functions, and a `handler` name resolves only inside the hook's own package. Before this change the door answered 200, the runtime then refused the hook at bind (`INVALID_REFERENCE` / 400, in the server log only), and the hook never ran. The refusal is `VALIDATION_ERROR` / 400, in draft and in publish mode, before anything is stored or bound. It names the hook and the function, and prescribes a `body`.

**Before and after** (with `{ name: 'stamp_status', object: 'crm_note', events: ['beforeInsert'], handler: 'x_stamp' }`):

- Before: 200 `Saved hook 'stamp_status'`, the row stored, the hook refused at bind and never run, and nothing on the response said so.
- After: 400 `VALIDATION_ERROR`, naming `stamp_status` and `x_stamp`, and nothing stored.

**What still saves.** A hook with a `body`. A hook carrying both a `body` and a `handler`: the binder runs the body and never consults the name, and the install-local door accepts the same shape. A malformed `body` still gets the type schema's located `422 INVALID_METADATA`.

**What is unchanged.** `HookSchema` still accepts the string `handler`, because a build artifact carries it: `objectstack build` lowers an inline function to the hook's name and ships the function in the artifact's runtime module. A hook in an artifact or a `defineStack` config binds to its own package's functions on its own door, which never reaches this one. `os validate` and `os build` are unchanged.

**Rows stored before this change.** They keep their bytes, nothing re-saves them, and the runtime refuses them at bind as before. A new save of one, a re-save included, is refused until it carries a `body`. Package duplication reports such a row as failed with this refusal; `migrate meta --stored` leaves it as it is. Delete stays open.

**The fix.** Give the hook a `body`: sandboxed JS (`{ language: 'js', source }`) or an expression (`{ language: 'expression', source }`). A hook that must run a package's own function belongs in that package's code, where its `handler` resolves.
