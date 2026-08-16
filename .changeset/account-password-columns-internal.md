---
"@objectstack/platform-objects": patch
"@objectstack/plugin-auth": patch
---

fix(security): `sys_account.password` and `previous_password_hashes` stop serializing on the data API — `internal: true`, with the raw-engine readers converted to the privileged accessor (#8676)

<!-- adr-0087: not-required (no-migration-prescription) Two field-level flags
added to one existing declaration, plus one new export on a plugin-internal
helper module (`internal-field-readback.ts`, not an exported surface of the
package). Nothing authorable is renamed, retired or tombstoned, so there is no
conversion to register. The behavioural change is that two columns holding
one-way password hashes stop being returned on the generic data path, while the
ADR-0069 D1 reuse ring and better-auth's sign-in verifier keep reading them
through the engine's privileged accessor. -->

`sys_account.password` (the credential hash) and `previous_password_hashes` (the
ADR-0069 D1 reuse-prevention ring) serialized on `/api/v1/data/sys_account`,
which declares `apiEnabled: true, apiMethods: ['get','list']` — to an **admin
for every user's row**, and to a **member for their own** (the
`sys_account_self` RLS policy grants `select` on `user_id == current_user.id`).

These are one-way hashes, not reversible outbound credentials — which is why
#7987 correctly refused to bundle them with the OAuth tokens. But a served
password hash is an offline-cracking target, and `previous_password_hashes`
multiplies it by the history ring while its own declaration says it is *never
exposed in UI*. This is the disposition #7728 already reached for
`sys_api_key.key`, which was **also** a stored hash and was still ruled unfit to
serialize through the API face.

Neither credential collector could reach them: `collectMaskedReadFields` keys on
the field **TYPE** (`secret` / `password`) *and* exempts objects declaring
`managedBy: 'better-auth'`, which this object is — while these columns are
`text` / `textarea`. Two independent barriers, both missing.

**The fix is two declarations plus two recovery seams**, and the second seam is
the part a bare flag would have missed:

- both columns are declared `internal: true` — the opt-in, type-independent flag
  from #7728 meaning *the declared value is never returned on the generic data
  path*. Storage, filtering and indexing are untouched: the strip runs on rows
  the driver has already produced.
- **better-auth's adapter readers** are recovered by the existing per-object
  readback table, widened with `password`: the sign-in verifier compares against
  the hash on the row `internalAdapter.findCredentialAccount(userId)` returns,
  so the strip alone would break password sign-in for every user.
- **plugin-auth's own RAW-engine readers** are recovered by a new seam in the
  same module, `recoverInternalFieldsForSystemRead`. This is the half that makes
  the flag safe: the readback table is imported by exactly one file
  (better-auth's storage adapter), so it cannot reach a caller that reads the
  engine directly — and the engine's strip has **no `isSystem` carve-out** by
  #7728's design. Measured against a real ObjectQL engine: the reuse ring's
  `findOne` returns `{"id":"a1"}` for a query that names both columns in an
  explicit projection under `context: { isSystem: true }`.

  Left unrecovered, `assertPasswordNotReused` would become a **silent no-op** —
  its comparison list empties, the loop never runs, `PASSWORD_REUSE` is never
  thrown, and its own `catch { return undefined }` means nothing announces it.
  The ADR-0069 D1 control would report success while accepting every reused
  password. Its unit tests would have stayed green throughout, because they use
  fake engines that never apply the strip.

**No ADR-0100 guard change, and none was needed.** `Engine.resolveInternalField`
has exactly one predicate — `internal === true` — so flagging the columns makes
them legitimately dereferenceable through the privileged accessor. The ADR-0100
sentence in its refusal message is prose explaining why a *non-flagged* field has
other channels, not a second predicate; the guard stays exactly as selective as
it was, and a non-flagged column on the same object is still refused with
`INVALID_FIELD` / 400.

Regression proof drives both directions on a real booted stack: both columns are
absent for both personas — including a caller who spells them out in `?select=` —
while the values remain on disk and reachable through the privileged accessor,
password sign-in still works, and the reuse ring still grows across a password
change on every transport lane.
