---
"@objectstack/spec": minor
"@objectstack/plugin-security": minor
---

fix(plugin-security,spec): the row-level and capability `403 PERMISSION_DENIED` refusals stop handing a business user internal authorization vocabulary

#7414 converted one template of this family — the object CRUD grant denial. The
same defect sat on the other gates of the same middleware that an ordinary,
non-admin principal reaches on ordinary business work. `Error.message` is the
body's human-readable string on every transport (`mapDataError`'s `body.error`,
the dispatcher's `error.message`) and Console renders it verbatim in a toast, so
a salesperson editing someone else's opportunity read

```
[Security] Access denied: not permitted to update this 'crm_opportunity'
record (row-level security)
```

English-only, naming a table they have never seen, and ending in the name of the
mechanism that refused them rather than anything they can act on.

Three gates now render the user's half through the shared operation-message
catalog (`@objectstack/spec/system`, the mechanism built for `DELETE_RESTRICTED`
and reused by #7414), overridable per deployment under `errors.<key>`:

- the row-level pre-image write denial renders `record_access_denied`;
- the row-level CHECK post-image denial renders `record_change_not_allowed`;
- the capability AND-gate (ADR-0066 D3) renders the existing `permission_denied`.

Two new catalog keys, in all four shipped locales, and not three: the rule is one
key per SITUATION, not per gate and not per wire code. A user blocked by
row-level security can often ask the record's owner; a user whose post-image
failed a CHECK can simply change what they typed; a user whose grants do not
cover the action needs an administrator. Those are three different next steps, so
they are three different sentences. A caller missing a CRUD bit and a caller
missing a `requiredPermissions` capability, by contrast, are in ONE situation with
one remedy — the difference between them is a fact about our authorization model,
which is exactly the vocabulary that must not reach a toast — so both render
`permission_denied`.

Each sentence names nothing: no object, no record id, no capability, no
mechanism. That was re-derived per site rather than inherited. The row-level
denial is the one gate here that COULD have named honestly, because the refused
record is the one the caller just addressed; it still does not, because the only
spellings available at the throw site are the object's API name and an opaque row
id, and reaching a label means the ladder whose last rung is the API name.

Each refusal keeps its developer half as `developerMessage`, the previous
sentence byte for byte, LOGGED at the throw site rather than shipped — following
#7414, which measured that REST's `mapDataError` builds `{ error, code, object? }`
and never reads `error.details`, so shipping it would ADD a disclosure on the
transport that discloses less. `developerMessage` is a sibling of `details`,
never a member, because `details` is what the runtime dispatcher serialises.

Enforcement is untouched: same 403, same `PERMISSION_DENIED`, same decision
logic, and every structured `details` payload — including `requiredPermissions`,
`missingPermissions` and `recordId` — is byte-identical to before.
