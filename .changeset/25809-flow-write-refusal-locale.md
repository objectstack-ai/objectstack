---
'@objectstack/service-automation': patch
---

fix(service-automation): a refusal a flow's write node meets is worded in the language of the person who started the run, as their own record save is

Clause-②: no
Metadata-protocol: none

A validation rule tripped through a record door (`POST` / `PATCH /api/v1/data/...`, batch, import) answers in the caller's locale: the engine looks the authored `message` up at `objects.OBJECT._validations.RULE.message` in the app's bundle. The same rule tripped by a flow's `create_record` or `update_record` answered in the authored English, and a `DELETE_RESTRICTED` refusal met by `delete_record` named its objects by their English labels — so a `FLOW_FAILED` from `POST /api/v1/actions/...` carried an English `innerRefusal.message` on a request whose screens rendered in Chinese.

The run already knew the language (`AutomationContext.locale`, seeded by the `/actions` and trigger doors); `resolveRunDataContext` dropped it from the context its data nodes hand the engine. It now carries `locale` on both `runAs` arms, and the engine's one translation hook does the rest. Nothing new translates anything: a run no person started has no locale and keeps the authored text.

What to do: nothing. Ship your translations under `objects.OBJECT._validations.RULE.message` as you already do for the record doors; a flow write now reads the same entry.
