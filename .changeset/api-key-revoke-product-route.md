---
"@objectstack/platform-objects": patch
"@objectstack/plugin-auth": patch
---

fix(platform-objects,plugin-auth): let the API-key revoke/restore actions actually run (#7727)

`sys_api_key` contradicted itself. It declared two row actions —
`revoke_api_key` / `restore_api_key` — as `PATCH /api/v1/data/sys_api_key/{id}`
with `bodyExtra: { revoked: true|false }`, while the same object set
`enable.apiMethods = ['get', 'list']`. The declared PATCH was refused at the
ADR-0049 method gate with `405 OBJECT_API_METHOD_NOT_ALLOWED` before any
authorization ran, so **no product route revoked an API key**: the Setup →
API Keys → Revoke button produced an error toast, the row still read
`revoked = false`, and the key kept authenticating. A leaked key could only be
retired by writing the row out of band.

Enforcement of the flag was never the problem — the verifier filters
`revoked: false` and re-checks the row, so a flipped bit takes effect on the
very next `x-api-key` call. The missing piece was purely the write path, and it
had **two** gates, not one:

- **The method gate.** `enable.apiMethods` now carries `update`. `create` and
  `delete` stay off: minting is `POST /api/v1/keys` (the only path that ever
  returns the raw secret) and keys are retired by revoking, not deleting.
- **The affordance reconciler.** ADR-0103's `reconcileManagedApiMethods` strips
  any write verb a `managedBy` object's resolved affordances do not grant —
  warning, not failing. So `apiMethods` alone would still have served 405 while
  the source read correctly. `userActions: { edit: true }` declares the
  affordance, exactly as `sys_user` does under ADR-0092 D4.

**Opening the method does not open the columns.** `sys_api_key` stays
`managedBy: 'better-auth'`, so ADR-0092 D2's identity write guard still
fail-closed rejects user-context writes, and its per-object update whitelist
remains the only opening. `revoked` is registered there and nothing else is:
`key` stays unwritable (a rotated hash would mint a credential nobody holds),
`user_id` stays unwritable (re-owning a key is privilege transfer), and
`expires_at` stays on the mint path. A PATCH carrying only non-whitelisted
columns is refused `403 PERMISSION_DENIED` rather than degrading into a
timestamp touch, and a mixed patch applies `revoked` while stripping the rest.
The guard itself is unchanged — no general weakening, and every other identity
table keeps its default-deny.

Per ADR-0092 D4's form-rendering constraint, the columns outside the whitelist
(`name`, `prefix`, `user_id`, `scopes`, `expires_at`) are now `readonly`, so the
edit form this affordance turns on cannot offer a write the server refuses —
the declared-≠-enforced shape that caused the original defect.

Nothing pinned any of this before: the existing tests exercise key *resolution*
against a pre-revoked row and never call the route the actions declare, which is
how a declared action and a method gate cancelled out unnoticed. The new
`api-key-revoke-lifecycle` dogfood suite drives the real PATCH, asserts `200`,
and then asserts the consequence — the key stops authenticating — because a 200
that leaves the key working is the defect wearing a success code.
