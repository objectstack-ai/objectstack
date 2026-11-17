---
"@objectstack/spec": patch
"@objectstack/core": patch
"@objectstack/plugin-security": patch
"@objectstack/plugin-approvals": patch
"@objectstack/plugin-audit": patch
"@objectstack/service-analytics": patch
"@objectstack/objectql": patch
"@objectstack/metadata-protocol": patch
"@objectstack/runtime": patch
"@objectstack/rest": patch
"@objectstack/service-print": patch
---

Clause-②: yes (widening)
Metadata-protocol: none

Four refusals the platform writes now carry a `userMessage` in the caller's language (the request locale, else the workspace default), beside a code, status and `message` that do not change. Before this a zh-CN user read each of them in English.

- `404 RECORD_NOT_FOUND`: "This record does not exist, or you do not have access to it." (`record_not_found`). It names no id and no API name, and it says both causes because the by-id doors answer an unreadable id exactly as a missing one.
- `403 PERMISSION_DENIED` for a query that filters, sorts or groups by a field the caller may not read (`query_field_not_readable`), from all four producers of that refusal: plugin-security, the approval snapshot guard, the audit parent-field guard and analytics. It names no field. The aggregate refusal is unchanged.
- `403 DELEGATION_SCOPE_VIOLATION`, a delegated administrator's write outside their own scope (`delegation_scope_violation`). The gate's reason stays in `message`.
- `409 RECORD_LOCKED` from an approval's record lock: the localized sentence is now also the `userMessage`, without the `RECORD_LOCKED: ` prefix. The bound refusals that name an API name for the developer mark none.

The three sentences are new keys of the shared operation-message catalog (`BUILTIN_OPERATION_MESSAGES`, in `en`, `zh-CN`, `ja-JP` and `es-ES`), so a deployment can override them under `errors.<key>` where the producer holds an i18n service. The widening: `@objectstack/spec` adds the catalog keys `record_not_found`, `query_field_not_readable` and `delegation_scope_violation`; `@objectstack/core` exports `operationUserMessage(messageKey, caller)` and its caller type `UserMessageCaller` for producers that hold no i18n service, and `recordNotFoundError` takes the caller as an optional third argument. Every door that holds the caller's execution context passes it, the action door's subject load, the flow-start door's row admission and the bulk update faces' existence check included, so the same miss reads in the same language at the data, action and flow-start doors.
