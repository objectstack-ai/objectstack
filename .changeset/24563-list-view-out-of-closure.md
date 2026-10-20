---
'@objectstack/lint': minor
---

fix(lint)!: the save door refuses a list view written into a package and bound outside that package's closure (#24563)

Clause-②: yes (narrowing)

**Why.** The runtime save door judges a write into a package against that package's closure (ruling #9612). The closure is the package's own objects, the objects of the packages its manifest declares in `dependencies`, platform/system objects, and provenance-less overlay rows; every other object is dropped from the snapshot before any rule runs. The list-view field rule read a binding missing from that snapshot as "an object this stack does not define" and skipped the whole list view. So a list view written into a package and bound to an object of a package it never declared, or to an object that exists nowhere, was stored with every field reference unjudged: `200`, no advisory. The same body as an overlay write is refused `422 list-view-field-unknown` for an unknown `columns` field. No other rule judged the binding on a `view` write, and such a view then fails at render ("This view's query was rejected").

**What is refused.** A list view written into a package whose bound object is outside the package's closure is refused with one `list-view-object-outside-closure` issue. The issue is located at the key the binding is read from: `views[0].data.object` for a standalone list view, otherwise the container's `objectName` / `object`. The hint names the remedy. An object that exists nowhere is refused the same way. This is the verdict the dataset door already gives an out-of-closure base object under the same closure (`object-reference-unknown`). An object written into a package whose built-in `listViews` entry retargets `data.object` outside the closure is refused the same way. The list view's field references stay unjudged until the binding is inside the closure.

**BREAKING — what moves for consumers.** This is an accept-set narrowing on the metadata save door, shipped as `minor` under the launch-window convention for accept-set narrowings (`.changeset/pre.json` is in `exit` mode, so the next version pass cuts 18.0.0 and this change ships in it).

- FROM: a publish-mode write of a list view into a package, bound outside the package's closure, answered `200` and was stored, with no issue. This covers `PUT /api/v1/meta/view/:name?package=…` (and `saveMetaItem` in publish mode), the promotion of a draft (`POST /api/v1/meta/view/:name/publish`, `publishMetaItem`), a package draft publish (`publishPackageDrafts`), and a package copy (`duplicatePackage`), which writes its copies through the same door.
- TO: `saveMetaItem` in publish mode, the draft promotion and `publishPackageDrafts` answer `422 INVALID_METADATA`, with the `list-view-object-outside-closure` issue at the binding, and nothing is stored. A package draft publish fails the item, and the batch with it. In `duplicatePackage`, a copied list view whose bound object stays outside the copy package's closure is refused with the same rule and listed in its `failed[]`. One way that happens is when that object's own copy was refused.
- Fix: declare a dependency on the package that defines the bound object in the `dependencies` of the writing package's manifest, or bind the view to an object the package may reach (its own, a declared dependency's, or a platform object). Then save again. Once the object is inside the closure its fields are judged: an unknown `columns` field is refused `422 list-view-field-unknown`, as at the overlay door. Saving the view as a draft (`mode: 'draft'`) is still allowed, because drafts are never gated; publishing that draft is judged.

**The next save of a stored list view bound outside its package's closure is refused with the fix; stored views keep serving until then.** The door judges writes only. A stored row is not re-judged at boot, and it loads and is served as before.

**Unchanged.**

- A list view bound to an object inside the closure (the package's own, a declared dependency's, a platform/system object, an overlay row): same field verdicts, same refusals.
- A write that names no package (an overlay write) is judged against the whole collection, exactly as before. An object that exists nowhere gets no closure verdict there; #24668 refuses it as `list-view-object-unknown` (see that changeset).
- The flow door: under the same closure, `flow-trigger-unknown-object` refuses an out-of-closure trigger object too (#24669, see that changeset).
- `os validate`, `os build` and `os lint`: no closure is stated, so the rule skips an unresolvable binding as before.
- `OS_ALLOW_UNLINTED_METADATA_WRITES=1` still turns a refusal into a logged write.
- Measured before crossing: the 11 views shipped in this repository carry 39 list-view bindings, in `examples/app-crm`, `app-todo`, `app-showcase` and `app-multi-package`, the `create-objectstack` blank template, and `qa/downstream-contract`. None is outside its package's closure, and the door's `view` rule set refuses none of them, with the package's closure or without it. None of the 97 platform built-in list views retargets `data.object`. Deployed rows were not measured.

**API.**

- `AuthoringRuleContext` gains an optional `packageScope` (`{ packageId, dependencies }`). Only the runtime publish gate sets it, and only when it narrowed the snapshot's objects to a package closure. `runAuthoringRules` never sets it.
- `validateListViewFieldRefs(stack, options?)` accepts an optional `{ packageScope }` (`ListViewFieldRefOptions`, exported).
- `LIST_VIEW_OBJECT_OUTSIDE_CLOSURE` (`'list-view-object-outside-closure'`) is exported.

<!-- adr-0087: not-required (no-migration-prescription) a refusal at the metadata save door of a list view written into a package and bound to an object outside that package's dependency closure: no authorable key, spelling, export or stored shape moves, and no stored row is read, rewritten or converted. A stored list view with such a binding keeps loading until it is next saved, and the repair is the author's choice of which package to declare as a dependency (or which object to bind), which no ledger entry can derive. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id covers this door (not already-registered); and the change is a door verdict, not a declaration or an export (not runtime-interface-only, type-surface-only or runtime-export-retired). -->
