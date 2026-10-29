---
'@objectstack/spec': minor
'@objectstack/lint': minor
'@object-ui/app-shell': minor
'@object-ui/plugin-detail': minor
'@object-ui/i18n': minor
---

feat(spec,lint,app-shell)!: a field group's `relatedList` names body tables only — a group naming a side card or a hidden list is refused, and Studio offers body tables only

Clause-②: no (narrowing)
Metadata-protocol: narrowed

<!-- adr-0087: registered field-group-related-list-side-card-refused -->

**BREAKING** for one shape: an object's `fieldGroups[i].relatedList` that names an inbound relationship which is not a body table of the record page. Ruling B on #27478: whether a related list is a body table is decided once, by the relationship's own keys on the child's FK (ruling B on #27055), and a field group only positions one.

- **Before.** A group's `relatedList` naming any inbound relationship parsed, passed `defineStack` and published, but the record page draws only body tables at a group: a group naming a side card (`task` through a plain lookup, say) drew nothing at the group and the card stayed in the related column, silently. Studio's group inspector offered every inbound relationship.
- **Now.** One predicate, `isBodyTableRelationship` (exported from `@objectstack/spec/data`), answers "is this inbound relationship a body table": its FK declares `relatedList: 'primary'`, or it is a `master_detail` FK that sets `inlineEdit` and declares no `relatedList`. A group whose `relatedList` names a relationship it does not count is refused where the child's fields are known: `defineStack` (`os validate`, `os build`) with a `STACK_CROSS_REFERENCE_INVALID` issue, and the object publish door (`PUT /api/v1/meta/object`, Studio, MCP) with `422 INVALID_METADATA`, rule `related-list-group-not-body` (`@objectstack/lint`, with an `os explain` entry). The sentence, written by `fieldGroupBodyTableRefusal` on both surfaces, names each FK that is not a body table (a side card, or hidden by `relatedList: false`) and the remedy. A bare child name names every FK of that child, so it is refused when any of them is not a body table, and the remedy points at `object.field` for the one that is. Children the name check leaves unjudged (another package's object) are left unjudged here too. `relatedLists` entries are not judged this way: they order body tables and side cards alike.
- **The remedy.** Mark the relationship `relatedList: 'primary'` on the child's FK (or, on an inline-edited `master_detail`, remove an explicit `relatedList: true`), name only the body table as `object.field`, or remove the group's `relatedList`. There is no automatic conversion: which edit the author meant is not recorded. The upgrade guide entry is `field-group-related-list-side-card-refused`.
- **One record page cell moves.** A `master_detail` FK that sets `inlineEdit` and declares `relatedList: true` is a side card, as `relatedList`'s description says ("write true to keep it a side card") and as Studio's relationship inspector writes it. The record page (`@object-ui/app-shell` `RecordDetailView`) used to draw it as a body table, because it kept its own copy of the rule that ignored `relatedList`. It now reads the spec predicate through `deriveRelatedLists`' `isPrimary`, so that list moves to the related column. `isMainContentList` (an internal helper of `@object-ui/app-shell`) is gone; its callers read `isBodyTableRelationship`.
- **Studio.** The field-group inspector's related-table picker (`@object-ui/app-shell`) offers body tables only, refuses to write any other pick, and shows a stored value that is not a body table with a line saying why the page draws nothing for it (`@object-ui/i18n`, en and zh).
- **Stored rows and built artifacts.** The object parse does not judge this, so a stored `sys_metadata` object row carrying such a group is not rewritten and still loads and registers unchanged; its record page draws what it drew before, except the one cell above. The next save of that object through the metadata write door is refused (`422`, at `fieldGroups[i].relatedList`) until it is fixed, and so is a write of the child that turns a body table a stored group places into a side card. A built artifact is judged when it is built. Census at the change: no example, platform object, dogfood fixture or HotCRM object (hotcrm `47a0666`) declares a field group `relatedList` at all; deployed metadata was not measured.
- **`@object-ui/plugin-detail`.** Documentation only: `bodyTablePlacement` and the `isBody` option name the spec predicate.
