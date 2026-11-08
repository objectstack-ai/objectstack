---
'@object-ui/plugin-calendar': patch
'@object-ui/i18n': patch
---

fix(plugin-calendar): a reschedule of a record that is gone for this session toasts a translated sentence naming the object by its label

Clause-②: yes (widening)
Metadata-protocol: none

- **`@object-ui/plugin-calendar`:** when a drag-to-reschedule is refused with `404 RECORD_NOT_FOUND` (the record was deleted, or row-level security no longer shows it to this user), the toast used to show the server's own sentence, "Record ID not found in OBJECT_NAME": English in every session, with the record id and the object's machine name. It now says, in the session language, that this record of the object (named by its label) no longer exists or is no longer accessible. The label is the one the object schema serves, else the app's translation of it; with neither, the toast says the existing generic "This record doesn't exist, or you don't have access to it." and never the machine name. The event still snaps back to its day. A refusal the producer marked for the user, an external-source refusal and a permission refusal keep their own messages, ahead of this one.
- **`@object-ui/i18n`:** `calendar.rescheduleNotFound` in all eleven locale packs (zh-Hant generated from zh-Hans).
