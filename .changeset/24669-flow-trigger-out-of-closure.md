---
'@objectstack/lint': minor
---

fix(lint)!: the save door refuses a flow written into a package whose trigger object is outside that package's closure (#24669)

Clause-②: yes (narrowing)

**Why.** The runtime save door judges a write into a package against that package's closure (ruling #9612): the package's own objects, the objects of the packages its manifest declares in `dependencies`, platform/system objects, and provenance-less overlay rows. Every other object is dropped from the snapshot before any rule runs. The dataset door already refused a reference outside that closure (`object-reference-unknown`), and the view door refuses one too (`list-view-object-outside-closure`). The flow door only advised: `flow-trigger-unknown-object` stayed a `warning` there, with the hint "ignore this if another installed package declares it". Under a closure that hedge is false, because the snapshot is the closure: an object outside it is one the package never declared it may reference. So the same mistake was refused at two doors and stored with an advisory at the third.

**What is refused.** A flow written into a package whose record trigger (`config.objectName` on a `record-*` start node) or time-relative sweep (`config.timeRelative.object`) names an object outside the package's closure is refused with one `flow-trigger-unknown-object` issue at `error`, located at that key. The hint names the remedy and the package. An object that exists nowhere is refused the same way, because the closure is all the snapshot sees. A `sys_`-prefixed name is still not judged, exactly as without a closure.

**BREAKING — what moves for consumers.** This is an accept-set narrowing on the metadata save door, shipped as `minor` under the launch-window convention for accept-set narrowings (`.changeset/pre.json` is in `exit` mode, so the next version pass cuts 18.0.0 and this change ships in it).

- FROM: a publish-mode write of a flow into a package, triggered on or sweeping an object outside the package's closure, answered `200` and was stored, with a `flow-trigger-unknown-object` save advisory. This covers `PUT /api/v1/meta/flow/:name?package=…` (and `saveMetaItem` in publish mode), the promotion of a draft (`POST /api/v1/meta/flow/:name/publish`, `publishMetaItem`), a package draft publish (`publishPackageDrafts`), and a package copy (`duplicatePackage`), which writes its copies through the same door.
- TO: `saveMetaItem` in publish mode, the draft promotion and `publishPackageDrafts` answer `422 INVALID_METADATA`, with the `flow-trigger-unknown-object` issue at `error` at the trigger key, and nothing is stored. A package draft publish fails the item, and the batch with it. In `duplicatePackage`, a copied flow whose trigger object stays outside the copy package's closure is refused with the same rule and listed in its `failed[]`. One way that happens is when that object's own copy was refused.
- Fix: declare a dependency on the package that defines the trigger object in the `dependencies` of the writing package's manifest, or trigger the flow on an object the package may reach (its own, a declared dependency's, or a platform object). Then save again. Saving the flow as a draft (`mode: 'draft'`) is still allowed, because drafts are never gated; publishing that draft is judged.

**The next save of a stored flow whose trigger object is outside its package's closure is refused with the fix; stored flows keep loading and firing until then.** The door judges writes only. A stored row is not re-judged at boot.

**Unchanged.**

- A flow triggered on an object inside the closure (the package's own, a declared dependency's, a platform/system object, an overlay row): no finding, as before.
- A write that names no package (an overlay write), a write naming a package the registry cannot produce, and the `sys_metadata` sentinel state no closure: an object the whole collection does not carry is still a `flow-trigger-unknown-object` save advisory, byte-identical to before.
- `os validate`, `os build` and `os lint`: no closure is stated, so the rule's verdict, severity and wording are unchanged.
- `OS_ALLOW_UNLINTED_METADATA_WRITES=1` still turns a refusal into a logged write.
- Measured before the change: every record-triggered or time-relative start node shipped in this repository (21, all in `examples/app-showcase` and `examples/app-todo`; no flow in `packages/apps`, `packages/platform-objects` or the `create-objectstack` template) triggers on an object its own stack defines, and objectui ships no such flow. Deployed rows were not measured.

**API.**

- `validateFlowTriggerReadiness(stack, options?)` accepts an optional `{ packageScope }` (`{ packageId, dependencies }`). Stated, an unknown trigger object is an `error`; omitted, the rule answers as before.
- The runtime publish gate hands `AuthoringRuleContext.packageScope` to this rule, which now reads it beside `validateListViewFieldRefs`.

<!-- adr-0087: not-required (no-migration-prescription) a refusal at the metadata save door of a flow written into a package whose trigger object is outside that package's dependency closure: no authorable key, spelling, export or stored shape moves, and no stored row is read, rewritten or converted. A stored flow with such a trigger keeps loading and firing until it is next saved, and the repair is the author's choice of which package to declare as a dependency (or which object to trigger on), which no ledger entry can derive. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id covers this door (not already-registered); and the change is a door verdict, not a declaration or an export (not runtime-interface-only, type-surface-only or runtime-export-retired). -->
