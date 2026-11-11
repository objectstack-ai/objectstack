---
'@objectstack/spec': patch
'@objectstack/plugin-security': patch
---

fix(plugin-security, spec): a create into a queue the caller does not belong to tells the user what to do instead of asking whether the record needs to be moved

Clause-②: no
Metadata-protocol: none

The queue refusal's `userMessage` ended on moving the record ("Contact your administrator if it needs to be moved", in all four locales), and it was also the sentence for a create into a queue the caller is not a member of, where nothing is being moved. That create now renders a sentence of its own, `errors.record_queue_assign_denied` in the operation-message catalog (en, zh-CN, ja-JP, es-ES): leave the queue blank or choose a queue you belong to, or contact your administrator. A change of an existing record's queue keeps `errors.record_queue_change_denied` and its sentence. Same split as the owner keys, `errors.record_owner_assign_denied` beside `errors.record_owner_change_denied`.

The HTTP status, `code`, `message` and `details` of both refusals are unchanged; only `userMessage` differs on the create. A deployment that overrides the queue sentence with a `translation` item and wants the create covered too adds `errors.record_queue_assign_denied`.
