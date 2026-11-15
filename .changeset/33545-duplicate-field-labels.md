---
'@objectstack/lint': minor
'@objectstack/spec': minor
---

feat(lint)!: refuse an object that shows two visible fields under one label (`field-label-duplicate`)

Clause-②: no (narrowing) — `os build`, `os validate`, `os lint` and the metadata publish door (an `object` write) now refuse an object whose visible fields, the platform's injected columns included, share one label in the authored text or in any locale a reader is served. Shipped first-party metadata hit: two example apps, relabelled here (`example-showcase`: `showcase_task.assignee` and `showcase_team.lead`, both served 负责人 to a `zh-CN` reader beside `owner_id`; `example-todo`: `todo_task.owner`, likewise); every other example, every first-party app under `packages/apps` and HotCRM build clean.
Metadata-protocol: narrowed
Skills-docs: none — the authoring half (an AI builder reusing `owner_id` instead of adding a second "Owner" field) is the skills lane's on the parent card; `os explain field-label-duplicate` carries the rule's full text, and four CLI transcripts in `content/docs` show the author-time rule count moving from 67 to 68.

<!-- adr-0087: registered object-field-label-duplicate-refused -->

**BREAKING** for metadata that builds today: an object that shows two or more visible fields under one label is now an error. Every surface draws a field under its label (list grid headers, kanban card lines, form captions, export and import columns), so two fields of one label are two columns a person cannot tell apart, and editing one reads as editing the other. The common case is a field added beside the platform's own: a `user` field labelled like `owner_id`, which a `zh-CN` reader is served as "负责人".

What is compared: the fields the object serves (its own plus every `objectExtensions` field of the stack) and the columns the platform injects on it (`owner_id`, `created_at`, `created_by`, `updated_at`, `updated_by`; the organization, business-unit and queue columns are hidden). A field declared under an injected column's name replaces it. `hidden: true` fields are not compared. Labels are compared trimmed, once as authored and once per locale (every locale a `translations` bundle carries, plus `en`, `zh-CN`, `ja-JP` and `es-ES`, the locales the platform translates the injected columns into), through the same `translateObject` the `/meta` read serves them with.

FROM → TO, and the fix:

- FROM an object with `assignee: { type: 'user', label: '负责人' }` beside the injected `owner_id` building clean TO `field-label-duplicate` naming `'assignee' and 'owner_id'`, the label and `locale zh-CN`. Fix: use `owner_id` instead of a second owner field, or label the field apart (for example "处理人"), or set `hidden: true` on it.
- FROM two authored fields labelled "Status" building clean TO the same error, naming both fields and no locale. Fix: give each its own label.
- FROM a translation bundle that gives two fields one label in one locale building clean TO the error naming that locale. Fix: translate them apart in that bundle.

At the publish door a write of another object is never refused for a clash a stored object carries; saving the clashing object itself is refused until the clash is fixed, as for every gating rule at that door. No boot or registration path runs the author-time rules, so an installed app keeps loading and serving its objects as before.
