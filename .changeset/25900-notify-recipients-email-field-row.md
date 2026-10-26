---
'@object-ui/app-shell': patch
---

fix(app-shell): the notify node's recipients editor writes and keeps an email-field recipient, `{ emailField }`

Clause-②: no
Metadata-protocol: none

- **A stored `{ emailField }` is kept.** The Studio recipients editor read `recipients: { emailField: 'FIELD' }` as no recipients, so the first edit of the node replaced it. It now reads as one Email field row, and reading the flow and saving it again writes it back unchanged.
- **An Email field row.** A recipient can be picked as "Email field": an `email`-typed field of the trigger record, stored as `{ emailField: 'FIELD' }`, the whole `recipients` value. Only `email`-typed fields are suggested. The row is offered only while it is the node's sole recipient, and no recipient can be added beside it. The commit that stores it also writes `channels: ['email']` when the node does not already name email alone; a stored one on a node that names other channels says so and offers a one-click fix.
- **The Record field row on a node that sends email.** It no longer suggests an `email`-typed field there: the platform refuses, at run time, an address that row computes when no user holds it. A stored Record field row over such a field keeps its value and says the address must belong to a user.

What to do: nothing. To mail a person who is not a user, pick "Email field" as the recipient type.
