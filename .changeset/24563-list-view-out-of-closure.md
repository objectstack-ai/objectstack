---
'@objectstack/lint': minor
---

fix(lint): a list view written into a package and bound outside that package's closure is reported at the save door, not skipped (#24563)

Clause-②: yes

**Why.** The runtime save door judges a write into a package against that package's closure (ruling #9612): the package's own objects, the objects of the packages its manifest declares in `dependencies`, platform/system objects, and provenance-less overlay rows. Every other object is dropped from the snapshot before any rule runs. The list-view field rule read a binding missing from that snapshot as "an object this stack does not define" and skipped the whole list view. So a list view written into a package and bound to an object of a package it never declared (or to an object that exists nowhere) was stored with every field reference unjudged: `200`, no advisory, while the same body as an overlay write is refused `422 list-view-field-unknown` for an unknown `columns` field. No other rule judged the binding on a `view` write.

**What changes.** At the runtime save door (Studio, REST `/meta`, MCP), a list view written into a package whose bound object is outside the package's closure now draws one `list-view-object-outside-closure` warning, located at the key the binding is read from (`views[0].data.object` for a standalone list view). It rides the save response's `advisories` and the `[Protocol] authoring advisory` log line. This covers a publish-mode save (`PUT /api/v1/meta/view/:name?package=…`, `saveMetaItem`), the promotion of a draft (`publishMetaItem`), and a package draft publish (`publishPackageDrafts`, on the published item's `advisories`). An object that exists nowhere draws the same warning. It is the verdict a flow's out-of-closure trigger object already gets at the same door (`flow-trigger-unknown-object`, `warning`): reported, not refused. The write is still stored, and the list view's field references stay unjudged until the binding is inside the closure. An object written into a package whose built-in `listViews` entry retargets `data.object` outside the closure draws the same warning.

- Fix: declare a dependency on the package that defines the bound object in the `dependencies` of the writing package's manifest, or bind the view to an object inside the closure. Once the object is inside, its fields are judged: an unknown `columns` field is refused `422 list-view-field-unknown`, as at the overlay door.

**Unchanged.**

- A list view bound to an object inside the closure (the package's own, a declared dependency's, a platform/system object, an overlay row): same field verdicts, same refusals.
- A write that names no package (an overlay write): judged against the whole collection, exactly as before. An object that exists nowhere stays silent there.
- `os validate`, `os build` and `os lint`: no closure is stated, so the rule skips an unresolvable binding as before.
- Drafts are not gated.
- Measured before the change: the 11 views shipped in this repository (`examples/app-crm`, `app-todo`, `app-showcase`, `app-multi-package`, the `create-objectstack` blank template, `qa/downstream-contract`) carry 39 list-view bindings. None is outside its package's closure. The door's `view` rule set finds nothing in any of them, with the package's closure or without it, before or after this change. None of the 97 platform built-in list views retargets `data.object`. Deployed rows were not measured.

**API.**

- `AuthoringRuleContext` gains an optional `packageScope` (`{ packageId, dependencies }`). Only the runtime publish gate sets it, and only when it narrowed the snapshot's objects to a package closure. `runAuthoringRules` never sets it.
- `validateListViewFieldRefs(stack, options?)` accepts an optional `{ packageScope }` (`ListViewFieldRefOptions`, exported).
- `LIST_VIEW_OBJECT_OUTSIDE_CLOSURE` (`'list-view-object-outside-closure'`) is exported.
