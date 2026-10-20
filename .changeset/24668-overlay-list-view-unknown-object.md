---
'@objectstack/lint': minor
---

fix(lint)!: the save door refuses a list view written with no package and bound to an object that exists nowhere (#24668)

Clause-②: yes (narrowing)

**Why.** A runtime write that names no package (an overlay write) is judged against the whole collection the deployment serves: every installed package's objects, the platform's, and the stored rows. Nothing narrows it. The list-view field rule still read a binding missing from that collection as "another package's object", which is the CLI's question, and skipped the whole list view. So a list view bound to a misspelled or deleted object was stored with every field reference unjudged: `200`, no advisory. It then failed only at render, because the data door answers `404 OBJECT_NOT_FOUND` for the object. The same body written into a package is refused `list-view-object-outside-closure`, and a dataset over an unknown object is refused `object-reference-unknown`.

**What is refused.** A list view judged against the whole collection whose bound object exists nowhere in it is refused with one `list-view-object-unknown` issue. The issue is located at the key the binding is read from: `views[0].data.object` for a standalone list view, otherwise the container's `objectName` / `object`. An object whose built-in `listViews` entry retargets `data.object` to an object that exists nowhere is refused the same way. The list view's field references stay unjudged, because there is no field map to judge them against. The hint names the nearest existing object when one is close.

**BREAKING — what moves for consumers.** This is an accept-set narrowing on the metadata save door, shipped as `minor` under the launch-window convention for accept-set narrowings (`.changeset/pre.json` is in `exit` mode, so the next version pass cuts 18.0.0 and this change ships in it).

- FROM: a publish-mode write that names no package, of a list view bound to an object that exists nowhere, answered `200` and was stored, with no issue. This covers `PUT /api/v1/meta/view/:name` with no `?package=` (and `saveMetaItem` in publish mode), the promotion of such a draft (`POST /api/v1/meta/view/:name/publish`, `publishMetaItem`), and a write naming a package the registry cannot produce, which narrows nothing.
- TO: the same writes answer `422 INVALID_METADATA`, with the `list-view-object-unknown` issue at the binding, and nothing is stored.
- Fix: bind the view to an object that exists (the hint names the nearest one), or save the object first, then save the view again. Once the binding resolves, its fields are judged as before: an unknown `columns` field is refused `422 list-view-field-unknown`. Saving the view as a draft (`mode: 'draft'`) is still allowed, because drafts are never gated; publishing that draft is judged.

**The next save of a stored list view bound to an object that exists nowhere is refused with the fix; stored views keep serving until then.** The door judges writes only. A stored row is not re-judged at boot, and it loads and is served as before.

**Unchanged.**

- A list view bound to an object that exists (an installed package's, a platform object, a stored overlay object): same field verdicts, same refusals.
- A write into a package is judged against its closure: `list-view-object-outside-closure` as before. When both could apply, the closure verdict wins.
- `os validate`, `os build` and `os lint`: the rule skips an unresolvable binding as before. There a stack is one app, and an unresolved binding may be a dependency package's object.
- A host that supplies no object collection at all: nothing is judged, as before.
- `OS_ALLOW_UNLINTED_METADATA_WRITES=1` still turns a refusal into a logged write.
- Measured before crossing, through the booted door (`pnpm dev:<app> -- --fresh`): the 49 views shipped in `examples/app-crm` (10), `app-showcase` (36) and `app-todo` (3), and the built-in list views of every object each stack serves, bind no object that exists nowhere. A probe list view bound to each object those stacks serve (82 in the CRM stack, one of them an overlay object saved with no package, then 109 and 76) was admitted every time. `examples/app-multi-package` ships no view. Deployed rows were not measured.

**API.**

- `validateListViewFieldRefs(stack, options?)` accepts `wholeCollection: true` in `ListViewFieldRefOptions`. The reference-integrity suite sets it for a runtime write with no package closure in force; `runAuthoringRules` never does.
- `LIST_VIEW_OBJECT_UNKNOWN` (`'list-view-object-unknown'`) is exported.

<!-- adr-0087: not-required (no-migration-prescription) a refusal at the metadata save door of a list view written with no package and bound to an object that exists nowhere in the collection the deployment serves: no authorable key, spelling, export or stored shape moves, and no stored row is read, rewritten or converted. A stored list view with such a binding keeps loading until it is next saved, and the repair is the author's choice of which object to bind (or to save the object first), which no ledger entry can derive. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id covers this door (not already-registered); and the change is a door verdict, not a declaration or an export (not runtime-interface-only, type-surface-only or runtime-export-retired). -->
