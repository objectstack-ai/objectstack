---
'@objectstack/spec': minor
---

An `email` field can declare that it identifies a correspondent for inbound mail: `mailAssociation`

Clause-②: yes (widening)

- **`mailAssociation: boolean`** (optional, no default) on a field definition. TRUE marks this email field as identifying a message correspondent: when a mailbox service ingests a message, it associates the message with every record of the object whose value in this field equals one of the message's participant addresses (From, Sender, Reply-To, To and Cc, plus those of a forwarded message it carries; ASCII case-insensitive; the receiving mailbox's own addresses excluded; only within the mailbox's organization). A message no record matches waits in the mailbox's unassociated pool. Absent or FALSE: the field takes no part in matching.
- **The platform learns which fields carry a correspondent's address, never what a contact is.** Every object that flags a field is treated alike; no app code and no resolver service is involved.
- **The door that judges it.** `FieldSchema` refuses the key on any type other than `email`, naming the field's type and the fix (change the type to `email`, or drop the key). Every metadata that parsed before parses unchanged.
- **Who reads it.** Nothing yet: the mailbox service's ingest is the reader, and it ships separately. Until then `objectstack validate` and `objectstack lint` warn an author who sets it (`liveness-planned-property`) that no mailbox service reads it yet.
- **Where to author it.** The field designer offers it on email fields as "Match Inbound Mail".
