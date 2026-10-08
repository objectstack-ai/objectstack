---
"@objectstack/spec": minor
"@objectstack/metadata-protocol": minor
---

feat(spec,metadata-protocol): each `GET /meta/_drafts` row carries the draft body's own `label`, or `null`

Clause-②: yes (widening)

- **What a client can now read.** Every row of the pending-drafts list (`GET /api/v1/meta/_drafts`, the runtime's `GET /metadata/_drafts`, and the SDK's `client.meta.listDrafts()`) carries `label`: the draft body's own top-level `label`. This list is the only place a client finds an item that exists only as a draft, so before this such an item could be shown by its machine name alone (a draft permission set read `technician`, not "Technician").
- **Its shape.** `I18nLabel | null`, required on the wire. It is carried as authored: a plain string, or an inline locale map (`{ en: …, 'zh-CN': … }`) on the types whose `label` is an `I18nLabel`. The route takes no locale, so the reader resolves a map the way it resolves every other `I18nLabel` (`resolveI18nLabel` in `@objectstack/spec/ui`).
- **When it is `null`.** The body declares no `label`; it declares one `I18nLabelSchema` refuses (a row stored before its type's schema was enforced on save, or a row of a type with no registered schema); or its stored bytes do not parse, in which case the draft stays listed and every read of its body still fails. It is never the item name standing in for a missing label: a reader that wants a fallback chooses it, knowing the label is absent.
- **Where it comes from.** `SysMetadataRepository.listDrafts` reads it off the `sys_metadata` row it already fetches, so there is no second query, and `ObjectStackProtocolImplementation.listDrafts` passes it through. Of the stored body, only this one member leaves; field definitions and every other body key stay off the header.
- **Unchanged.** The other six members, the filters (`?packageId=`, `?type=`), the org scope, and the authoring gate on both routes.
