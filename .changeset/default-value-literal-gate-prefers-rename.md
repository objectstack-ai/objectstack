---
"@objectstack/spec": patch
---

The authoring-time `defaultValue` gate now prescribes the key rename an author actually made, instead of a type error about a member they never wrote.

`checkLiteralDefaultValue` — the shared core of the field gate (`FieldSchema.defaultValue`) and the action-param gate (`ActionParamSchema.defaultValue`) — read a value-contract rejection positionally, `result.error.issues[0]`. zod reports per-member issues before the object-level `unrecognized_keys` one, so on a default whose keys were **renamed** the actionable message sorted last and was discarded. An `address` default authored as `{ street: 5, postal_code: '98101' }` answered `Invalid input: expected string, received number`, and a `location` default authored as the legacy `{ latitude, longitude }` pair answered `Invalid input: expected number, received undefined` — while `AddressValueSchema` and `LocationValueSchema` had each built the rename prescription and thrown it away. Which of the two the author got depended on whether some unrelated member happened to also be wrong: nobody chose that, and nobody could see it.

The gate now prefers the undeclared-key issue when the rejection carries one. `LiteralDefaultValueVerdict.detail` keeps its name, its type and its documented meaning — "the 'why' a refusal carries verbatim"; what changes is which of several already-reachable messages it carries.

⛔ No verdict moves. Exactly the same defaults are accepted and refused, on the same evidence — only the refusal text changes.

Scoped by measurement rather than inherited: the sixteen classes `valueSchemaFor(def, 'stored')` covers were swept again on this function, at both arities. Only `location` and `address` can emit `unrecognized_keys` at all, because only they are backed by a key-closed object schema — for the other fourteen the preference cannot change a single character. Both classes it does reach curate the alias map that makes the undeclared key the more actionable half of the rejection.
