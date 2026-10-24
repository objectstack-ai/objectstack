---
'@objectstack/spec': minor
---

docs(spec): a `notify` node's `recipients` names an email address written out as an author constant, not an audience selector

Clause-②: no
Metadata-protocol: semantic
Ruling-ref: 6386629237

The `recipients` text of a `notify` node config — its `describe()` (read by the reference docs and the JSON Schema), the union's description, and the sentence a refused `recipients` value leads with — now says what an email address in `recipients` means:

- **Written out as a string, it is an author constant.** `recipients: 'ops@example.com'` is no audience selector: it is sent as written, to the user who holds that address, or else, on the `email` channel, to the address itself. Nothing about it changes; the text stopped calling it an audience selector. The audience selectors are the prefixed forms, such as `team:ID`.
- **An address a CEL envelope evaluates to is not one.** It resolves to the user who holds it. Failing the node on an address that no user holds, with a message pointing to `{ emailField }`, is **planned and not made yet**: until the runtime check lands, such an address is still handed to the messaging service as written, and the text says so rather than claim a refusal the runtime does not make.

No key, shape, default or accepted value changes; everything that parsed still parses, and authored metadata needs no change.
