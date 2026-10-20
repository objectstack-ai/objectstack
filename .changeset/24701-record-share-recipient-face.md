---
'@objectstack/plugin-sharing': patch
---

fix(plugin-sharing): a record share's Recipient column names the recipient instead of drawing its raw id

Clause-②: no

- **`sys_record_share.recipient_id` declares `widget: 'recipient-picker'` and `dependsOn: ['recipient_type']`**, the display declaration `sys_sharing_rule.recipient_id` already carries. The console draws a field with this widget by naming the stored id through the row's `recipient_type`, so a user grant reads as the user's name in a list that shows the Recipient Type column beside it (Setup → Record Shares → All). A list that does not fetch `recipient_type` still draws the stored id.
- **`object_name` is not a dependency here**: the face reads it only for the `field` recipient kind, which a record share cannot store.
- **Unchanged:** `recipient_id` stays the same required text column, the object stays engine-owned and read-only through the data API, and `grant()` stays the only writer of a share row.

A patch: one display hint on one field of a shipped platform object. No export, type, accepted value, stored column or authorable key changes.
