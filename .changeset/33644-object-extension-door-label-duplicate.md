---
'@objectstack/lint': minor
'@objectstack/spec': minor
---

fix(lint): the runtime `object_extension` publish door refuses an extension that adds a field under a label the object it extends already shows, or under the label of another field of the same extension (`field-label-duplicate`)

Clause-②: no (narrowing) — the `object_extension` publish door (Studio's add-field on a `.custom` pair, `PUT /api/v1/meta/object_extension/TARGET`, the MCP and AI authoring doors) now refuses an extension whose fields create a `field-label-duplicate` clash on the object it extends. No exported type or signature changes. Measured first-party: the two extension entries (`examples/app-showcase` on `showcase_account`, three fields; `packages/plugins/plugin-auth` on `sys_sso_provider`, one `secret` field) add no clash, as written or in any locale, so nothing first-party is newly refused. HotCRM: not measured.
Metadata-protocol: narrowed
Skills-docs: none owed — this PR edits `content/docs/deployment/validating-metadata.mdx` (the object extension door paragraph names the rule); `os explain field-label-duplicate` names the door; `skills/objectstack-data` teaches `defineObjectExtension({ extend, fields })` and reusing `owner_id` instead of a second owner field without saying the runtime door is exempt, so the door now gives the verdict the build already gives.

<!-- adr-0087: registered object-extension-door-field-label-duplicate-refused -->

**BREAKING** accept-set narrowing of the runtime `object_extension` publish door (`lintDuplicateFieldLabels` joins its `runtimeTypes`).

`os build`, `os validate` and `os lint` refuse an object whose visible fields share one label, extension fields of the same stack folded in, and the publish door refused it on an `object` write. An `object_extension` write ran no such judgment, so an extension could add a field under a label its target already shows (a `user` field labelled 负责人 beside the injected `owner_id`, which a `zh-CN` reader is served as 负责人), or two fields of its own under one label, and publish with a 200: two columns of one name in every grid, card and form of the object.

- On an `object_extension` write the rule judges the target as it will be served after the write: the door's live target without the package's own stored extension (which the write replaces), the written entry folded in among the target's other packages' extensions by priority, as `os build` folds every package's entry. A field two packages add at the priority that decides it is left out, as at the build. The injected columns are read as the platform's, so the finding names `owner_id` as the platform's column.
- A refusal is the gate's `422 INVALID_METADATA` with issue rule `field-label-duplicate`, located on the extended object (`objects.TARGET.fields`), naming the object, every field of the group, the shared label and, when only some locales clash, those locales: the message the build gives for the same entry.
- The write is charged only with a clash its entry creates: a clash the target already carries is not the extension's to answer for, nor is what is left of one after the entry took a field out of it (a new label, `hidden: true`, or a tie at the deciding priority); an entry that joins one changes the group and is refused.
- Unchanged: the object save door, `os build`, `os validate`, `os lint`, a draft save (never gated), and a stored extension, which is served and is judged only when it is published again.

Migration: before publishing an extension again, give each field it adds a label the extended object does not already show and no other field of the same extension carries, set `hidden: true` on it, or drop it and use the field the object already has (the platform's `owner_id` for an owner). The door compares labels as written and as the platform translates its own columns; it reads no translation bundle, so a bundle edit neither raises nor clears a refusal there (`os build` and `os validate` judge the bundle). Upgrade-guide entry `object-extension-door-field-label-duplicate-refused`.
