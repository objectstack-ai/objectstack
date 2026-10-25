---
'@objectstack/spec': minor
---

docs(spec): a `notify` node's `recipients` names an email address written out as an author constant, not an audience selector, and states the computed-address and email-field behaviour the runtime makes

Clause-②: no
Metadata-protocol: semantic
Ruling-ref: 6386629237

The `recipients` text of a `notify` node config now says what an email address in `recipients` means, and what the notify node does with one. That text is the field's `describe()` (which the reference docs and the JSON Schema read), the union's description, and the sentence a refused `recipients` value leads with.

- **Written out as a string, it is an author constant.** `recipients: 'ops@example.com'` is no audience selector. It is sent as written: to the user who holds that address, or else, on the `email` channel, to the address itself. Nothing about it changes; the text no longer calls it an audience selector. The audience selectors are the prefixed forms, such as `team:ID`.
- **An address a CEL envelope evaluates to is not one.** In a node whose `channels` include `email`, a computed recipient that reads as an address, bare or as `user:ADDRESS`, must belong to a user. One a user holds resolves to that user. One that no user holds fails the node, and the message points to `{ emailField }`. A node that does not name `email` (`inbox` alone, the default) mails nobody, so its computed recipients go to the messaging service as before. The screen is scoped to nodes that include the `email` channel (confirmed by the maintainer).
- **`{ emailField }` is delivered.** The text no longer says delivery is not live. The address is read from the stored trigger record when the node runs. It must be one plain ASCII mailbox, or the node fails and nothing is sent. One address receives at most 5 such emails per hour; the limit is best-effort.

No key, shape, default or accepted value changes. Everything that parsed still parses, and authored metadata needs no change.
