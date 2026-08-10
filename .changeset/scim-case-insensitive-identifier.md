---
"@objectstack/plugin-auth": patch
---

fix(plugin-auth): honour better-auth's `Where.mode`, and normalise the identifier SCIM matches on (#5814)

better-auth's `Where` carries a fourth field — `mode?: "sensitive" | "insensitive"`,
`@default "sensitive"` — and `convertWhere()` in the ObjectQL adapter read `field` /
`operator` / `value` and nothing else. The default covers almost every caller, so the
drop was invisible; the caller it is not invisible for is the one that explicitly asked.

`@better-auth/scim` is that caller. SCIM's `userName` is case-insensitive by RFC 7643
(`caseExact: false`), so a `filter=userName eq "Alice@example.com"` reaches this adapter
as `{ field: 'email', operator: 'eq', mode: 'insensitive' }`. With `mode` unread, whether
it matched a user stored as `alice@example.com` came down to how the driver under the
auth path happens to compare strings — and because SCIM provisioning is "look up, create
if absent", a missed match did not raise an error, it provisioned a **second user**.
Only deployments that turned SCIM on (`OS_SCIM_ENABLED`, off by default) were exposed.

Both halves of the fix, per the maintainer's ruling on #5814:

- **Normalisation, not new vocabulary.** `sys_user.email` — the field SCIM's `userName`
  maps onto — is now stored lower-cased and compared lower-cased by this adapter. An
  insensitive lookup lower-cases its comparand, which is an *exact* match against the
  stored form, so nothing in the query vocabulary changes. The set is a declared table
  (`NORMALISED_IDENTIFIER_FIELDS`), not a name heuristic, and it drives the read and
  write halves from one place so a field cannot be added to one of them only.
- **The silent drop ends.** `convertWhere()` handles `mode` explicitly. On a normalised
  identifier the request is satisfied by construction. On **any other** field, a
  `mode: 'insensitive'` clause now emits a loud warning naming the model, the field and
  the operator, and stating that the query is being answered case-sensitively — instead
  of answering a different question and looking fine doing it. It deliberately does not
  throw: refusing here would turn an occasional duplicate user into "`userName` queries
  entirely unavailable", which is the worse trade on an authentication path.

No migration ships and none is needed. Every existing write path already lower-cased
`user.email` before reaching the adapter (better-auth's own `internalAdapter` does it on
`createUser` / `createOAuthUser` / `updateUser` / `updateUserByEmail`, and SCIM's create
path does it again), so the write half changes no existing behaviour — it moves the
invariant the read half depends on into the layer that depends on it, instead of
inheriting it from an internal of a prerelease dependency. Queries that do not set
`mode`, or set it to `"sensitive"`, keep their comparand byte-for-byte: folding case
unasked would be the same failure in the opposite direction.

Adding a case-insensitive equality operator (`$ieq`) was deferred until there is
demonstrated pull for it, and downgrading `eq + insensitive` to `$icontains` was
rejected — containment is not equality.
