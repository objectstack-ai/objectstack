---
'@objectstack/service-automation': patch
---

fix(service-automation): a `notify` node naming `email` and another channel mails an address no user holds and no longer writes an inbox row addressed to it

Clause-②: no
Metadata-protocol: none

An email address written out in `recipients` is the author's constant: on a node whose `channels` name `email` it is mailed as written. The inbox delivers to a user, keying its row by the recipient as a user id, and so does every channel but `email`. So on a node whose `channels` name `email` and another channel, such as `['inbox', 'email']`, an address no user holds now goes to the email channel alone.

- **Fixed.** Before, the address went to every channel as it stood: the email channel mailed it, and the inbox also wrote a `sys_inbox_message` row whose `user_id` was the address, which no inbox reads. Now the node emits that address apart, on the `email` channel only, and the inbox writes no row for it. `user:ADDRESS` is handled the same way, whoever holds the address, because `user:` hands the address on as the user id with no lookup. An address whose holder cannot be looked up (no data engine, a lookup that fails) is mailed alone too.
- **Unchanged.** The node succeeds as before. An address a user holds, written bare, still reaches that user's inbox and is mailed. A value expression that evaluates to an address on a node naming `email` still resolves to the user who holds it, or fails the node pointing to `{ emailField }`. A node that does not name `email` still fails on an address no user holds.
- **What a run records.** When a node's recipients mix users and such addresses, the node writes two `sys_notification` events: one for the users on the node's `channels`, which the node's `notificationId` output names, and one for the addresses on `email` alone. The `delivered`, `enqueued` and `failed` outputs add up both.
- **Who moves.** Nobody needs to change a flow. A report or audit over `sys_inbox_message` no longer sees rows whose `user_id` is an address.
