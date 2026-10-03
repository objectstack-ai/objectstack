---
"@objectstack/lint": minor
---

fix(lint)!: `action-name-undefined` resolves `record:related_list` action ids against the related object, and refuses an id the list cannot draw (#20936)

Clause-②: no (narrowing)

`action-name-undefined` is the authoring gate for "a surface names an action that renders nothing". It already walked list-view row and bulk menus, the `record:quick_actions` bar, the `record:alert` call-to-action, the `page:header` action ids and app navigation. One page surface that binds actions by id was never read: `record:related_list` → `properties.actions`.

The console now reads that key. It resolves each id against the RELATED (child) object's own actions, never the page's object, and places it by that action's own `locations`: `list_toolbar` draws a header button, `list_item` and `record_related` draw a row-menu item. An id that names no action of the child object, or an action placed at none of those three, draws no button; the list shows a refusal notice naming it instead. The spec types the key as plain strings, so a misspelled id passed spec validation and lint and surfaced only at runtime.

The rule now walks the key, scoped to `record:related_list`, and answers the same two questions the renderer asks:

- each string id must name an action of the related object: one written on that object, or a `stack.actions` entry bound to it by `objectName`. An id defined only on the page's object, or only as a global action, is refused like a typo, and the message names where it is defined. The did-you-mean and the hint's action list are the related object's own;
- the action it names must declare at least one location a related list draws. The location set is read from the spec's `ACTION_LOCATIONS` vocabulary, classified per member, so a location added to the vocabulary has to be classified before this package compiles.

The related object is the component's bound `dataSource.object` when one is set, otherwise `properties.objectName`. A related object this stack does not define is skipped: its actions belong to another package, and the rule does not guess. Inline-object elements are skipped, as on `page:header`, and every id is reported at its authored index. Every other walk of the rule is unchanged: it still asks only whether a name is defined anywhere in the stack.

**What moves for consumers.** A stack whose related list names an id the list cannot draw built clean before and now fails `os validate` / `os lint` / `os build` with `action-name-undefined` (severity `error`). That id never rendered a button, so nothing that worked stops working. The rule still does not run at the runtime publish door for `page` writes. No related list in the platform's own pages or in the example apps authors `actions`, so none of them changes.

<!-- adr-0087: not-required (no-migration-prescription) a refusal at authoring of record:related_list action ids that the console already refuses at runtime with a visible notice: an id that names no action of the related object, or an action declaring none of the locations a related list draws. No authorable key, spelling, export or stored shape moves: RecordRelatedListProps keeps parsing every value, no stored row is read or rewritten, and which action an author meant to name is not something a ledger entry can rewrite. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id covers this key (not already-registered); and the change is a rule verdict, not a declaration (not runtime-interface-only or type-surface-only). -->
