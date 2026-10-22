---
'@objectstack/spec': minor
'@objectstack/lint': patch
---

feat(spec)!: a `controlled_by_parent` object whose one required `master_detail` is marked `readonly: true` or `system: true` is refused at parse

Clause-②: no (narrowing)

Metadata-protocol: narrowed

<!-- adr-0087: already-registered cbp-master-relation-tiers-retired -->

**BREAKING** (a declaration the parse accepted is now refused), shipped as `minor` under the 18.x convention for breaking changes, with no retirement stage.

ADR-0055 §1: a `controlled_by_parent` object derives its record access from exactly one required `master_detail` field. That one master must be a reference every write of a detail supplies, and a field declared `readonly: true` or `system: true` is not one an author's write supplies, so it cannot be that master. `os lint` already reported it at `error` under `relationship/master-detail-required`, but `os lint` is not a publishing door: `os validate`, `os build`, `ObjectSchema.create()`, `defineStack` and the metadata save door accepted it.

- **FROM:** `sharingModel: 'controlled_by_parent'` with one required `master_detail` declared `readonly: true` and/or `system: true` parses, builds and saves.
- **TO:** the parse refuses it at `fields`, naming the object, the field and each flag (the message opens with "Object 'OBJECT' declares sharingModel 'controlled_by_parent' with its one required master_detail, FIELD, marked readonly: true", with each name and flag in a code span). The save door answers `422 INVALID_METADATA` with that issue and stores nothing. `ObjectSchema.create()` refuses it too, because the parse it ends in is the same rule. An objectExtensions entry that leaves the merged master flagged is refused at the extension, as before for the other shapes.
- **The fix:** remove `readonly: true` and `system: true` from the master reference and declare it as an ordinary required field. If the rows must outlive their parent, the object is not a detail: give it its own `sharingModel` (`private`, `public_read` or `public_read_write`).
- **Unchanged:** the runtime. The flags do not change which field the runtime resolves as the master. A flag on a second, non-required `master_detail` beside the master is still reported by `os lint` alone.

Data at rest still loads. A stored object in this shape registers under its `[metadata_spec_invalid]` diagnostic, and `os migrate meta --stored` lists it as a TODO under `cbp-master-relation-tiers-retired`. No conversion rewrites it: dropping the flag changes who may write the reference, which is the owner's decision.

`@objectstack/spec/data`: `controlledByParentMasterRefusal` returns the new shape `master-not-writable` for this object, so a producer that asks it before writing `controlled_by_parent` gets the parse's verdict. `ControlledByParentMasterShape` gains that member. `isControlledByParentMasterField` is unchanged: a flagged required `master_detail` still counts as the master, so beside a second required one the object is still refused as having two.

`@objectstack/lint`: the `relationship/master-detail-required` explanation (`os explain`) now says that the parse refuses every shape that leaves the object without exactly one writable required master, and that a shape on a second, non-required `master_detail` is this rule's report alone.
