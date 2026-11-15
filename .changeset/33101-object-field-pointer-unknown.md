---
'@objectstack/lint': minor
---

fix(lint)!: `os build`, `os validate`, `os lint` and the runtime object publish door refuse a `nameField`, `displayNameField` or `activityMilestones[].field` that names no field of the object

Clause-②: no (narrowing) — `os build`, `os validate`, `os lint` and the runtime `object` save/publish door (Studio, `PUT /api/v1/meta/object/NAME`, `POST /api/v1/packages/PKG/publish-drafts`, the MCP and AI authoring doors) now refuse an object whose title pointer or milestone field names neither a field of the object nor a column the platform injects on it. No exported type or signature changes. Measured first-party: 137 objects under `packages/` and `examples/` (92 with a title pointer, 1 milestone) and HotCRM (20 title pointers, 5 milestones) all resolve, so nothing first-party is newly refused.
Metadata-protocol: narrowed
Skills-docs: none — `skills/**` teaches `nameField` / `displayNameField` as pointers at a field of the object and never says a dangling one is accepted, and does not enumerate the `object-field-ref-unknown` positions.

<!-- adr-0087: registered object-field-pointer-unknown-refused -->

**BREAKING** accept-set narrowing of `os build`, `os validate`, `os lint` and the runtime `object` publish door (`@objectstack/lint`'s `object-field-ref-unknown`, error).

- **Before.** Each key is a bare string the schema cannot judge, and no rule judged it for existence: `title-unresolvable` reports only an object with no title pointer at all. So `displayNameField: 'nope'` and `activityMilestones: [{ field: 'nope', … }]` saved, published and were served. A title pointer that names no field titles every record by its id (`Record #ID`, and the activity timeline's record label is the id); a milestone whose field names no field never fires.
- **Now.** `nameField`, `displayNameField` and each `activityMilestones[N].field` are judged by `object-field-ref-unknown` at `error`, verbatim (each reader takes the name as a record key, so a dotted name is one name no field carries), against the object's own fields plus the columns the platform injects on it (`id`, `created_at`, `updated_at`, `created_by`, `updated_by`, `owner_id` on an owned object, `organization_id` on a tenant object). A name the title pair shares (the parse copies `displayNameField` onto `nameField` when that is absent) is reported once, at `displayNameField`. At the door the refusal is `422 INVALID_METADATA` at `objects.NAME.nameField`, `objects.NAME.displayNameField` or `objects.NAME.activityMilestones[N].field`; the publish probe's receipt reports the same finding on the published body (`object_field_ref_unknown`).
- **Unchanged.** A draft save (never gated), a stored object (judged when it is next saved, published or restored), `stageField` (still `semantic-role-field-unknown`, a warning), and every runtime read.
- **Fix.** Point the key at a field the object declares, or at a column the platform injects on it, spelled exactly; drop the key or the milestone when no field is meant. Upgrade-guide entry `object-field-pointer-unknown-refused`.
