---
"@objectstack/service-messaging": patch
---

fix(service-messaging): a notification delivery's title names the person it is for, not their raw user id (#25194)

Clause-②: yes (widening)
Metadata-protocol: none

The record title of a `sys_notification_delivery` row (Setup → Notification Deliveries) read `channel → recipient_id`, so a delivery to a user showed their raw user id. It now reads `channel → Person`: the user's name, or their email where the name is blank. A delivery to an address no user holds — an email kept as given, a phone number — is titled by that address, as before.

The delivery object gains one optional field, `recipient_user_id` (Recipient User), a `sys_user` reference the title reads through. `emit()` sets it when the recipient is a user's id, from one `sys_user` read per emit, and leaves it empty for an address. Deleting the user empties it; the delivery stays, titled by the raw recipient. `recipient_id` keeps its type and meaning (the address: a user id, an email or a phone number), and is now labelled **Recipient**.

Rows written before this change carry no `recipient_user_id` and keep their old title until the 90-day window ages them out. Nothing is migrated, and no delivery is routed by the new field.
