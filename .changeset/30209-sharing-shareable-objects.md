---
'@objectstack/plugin-sharing': patch
---

feat(plugin-sharing): list the objects a sharing rule can take effect on

Clause-②: yes (widening)
Metadata-protocol: none

`SharingServicePlugin` mounts a read-only route, `GET /api/v1/sharing/shareable-objects`, for Setup's sharing-rule object picker. It answers `{ success: true, data: { objects } }`, each object `{ name, label, system }`, business objects first and then platform objects, each group by label.

An object is listed exactly when a sharing rule saved on it would take effect: the list asks the same check the save doors already ask (`SharingService.sharingRuleObjectRefusal`), so every object it leaves out is one a save refuses with `SHARING_NOT_ENABLED`. The platform's credential and session objects (sessions, linked accounts, API keys, verification tokens, two-factor rows, OAuth applications, tokens and consents, signing keys, secrets) are not listed.

Who may ask: the sharing-rule administrators, as `/api/v1/sharing/rules` admits them (`manage_sharing`, or the legacy `manage_platform_settings`, with an active organization). Anyone else is answered `403 PERMISSION_DENIED`, anonymous `401`. The route takes no query parameter and refuses one with `400 VALIDATION_ERROR`. With record-sharing enforcement off (`enforce: false`) it answers `501 NOT_IMPLEMENTED`.

`SharingRuleService` gains `listShareableObjects(context)`, the same list for in-process callers.

Nothing stored or authored changes; the `sys_sharing_rule` object field keeps its `object-ref` picker until the console's filtered picker lands.
