---
'@objectstack/spec': patch
'@objectstack/runtime': patch
---

fix(runtime): the approval action-page door and the inbound automation hooks answer their 501 in the request's language

Clause-②: yes (widening)
Metadata-protocol: none
Skills-docs: none (no page under `skills/**` names these doors' `501` sentences)

The approval action-page door (`/approvals/act`) and the inbound automation hook route (`/automation/hooks/:flow/:hook`) now answer their `501 NOT_IMPLEMENTED` in the request's language, as the comment, webhook redelivery, print, personal-view and attachment doors do. On a kernel with no `approvals` or `trigger-api` service, or with one that lacks `handleActionPage` / `handleInboundHook`, a `zh-CN`, `ja-JP` or `es-ES` request read the sentence in English. The operation-message catalog (`BUILTIN_OPERATION_MESSAGES`, `@objectstack/spec/system`) gains `approvals_act_service_unregistered`, `approvals_act_member_missing`, `automation_hooks_service_unregistered` and `automation_hooks_member_missing` in `en`, `zh-CN`, `ja-JP` and `es-ES`. Their English is the sentence each door answered before, byte for byte. Code and status do not change, and no `userMessage` is added.

The catalog's notes on these whole-sentence `501` keys now say how they are read: by the request's top `Accept-Language` tag, with no `errors.` override consulted.
