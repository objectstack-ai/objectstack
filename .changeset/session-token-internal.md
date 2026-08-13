---
"@objectstack/platform-objects": patch
"@objectstack/objectql": patch
"@objectstack/metadata-protocol": patch
"@objectstack/plugin-auth": patch
"@objectstack/rest": patch
---

fix(security): `sys_session.token` stops serializing on the data API — `internal: true`, with the write-response strip relocated to the generic-data-path ingress (#7823)

<!-- adr-0087: not-required (no-migration-prescription) One field-level flag added
to one existing declaration, plus an internal relocation of where that flag's
write-response half is enforced (engine write sites → the metadata-protocol
ingress). Nothing authorable is renamed, retired or tombstoned, so there is no
conversion to register. The behavioural changes are that a field which already
DECLARED it was never exposed stops being exposed, and that better-auth's
session-lifecycle routes keep working while it does. -->

`sys_session.token` — the **live bearer credential** for an active session —
declared `description: 'Opaque session token — never exposed in UI'` and then
serialized anyway on the generic data path.

**Scope the persona precisely: this is an ADMIN-CROSS-USER disclosure**, not an
any-authenticated-caller one. Measured on a real engine (`bootStack(showcaseStack)`,
in-process HTTP + sqlite-wasm):

- **admin**, `GET /data/sys_session` (list) — 200, `token` present on every row,
  the admin's own **and every other user's**;
- **admin**, `GET /data/sys_session/{another user's id}` — 200, that member's
  token verbatim;
- **admin**, `?select=id,token` — 200, present;
- anonymous — 401, fully denied;
- member — self-scoped reads only, and a cross-user get-by-id still answers
  **404**: the `sys_session_self` RLS policy was already holding that line and
  is untouched here.

**Why this is more than exposure.** The sibling column closed by #7728
(`sys_api_key.key`) is a stored SHA-256 hash. This one is not: the disclosure was
**replay-proven** — a member's token, taken exactly as it came back to the admin
off the data API, authenticates as that member when sent as
`Authorization: Bearer <token>`. So the defect was admin-to-member
**impersonation**, and any admin-adjacent read (an integration, a leaked admin
API response, a support tool) inherited it.

**The fix is one declaration plus one relocation** (maintainer ruling
2026-08-13, "A-prime + compose"):

- `sys_session.token` is declared `internal: true` — the opt-in,
  type-independent flag minted by #7728 meaning *the declared value is never
  returned on the generic data path*. The engine's READ-path strip is
  unchanged and closes the disclosure.
- The flag's **write-response** half moves out of the engine's insert/update
  result paths — where it conflated "never on the generic data path" with
  "never returned to the engine-level writer" and broke `signIn`/`signUp`
  (better-auth reads the minted session row back off the insert result) —
  into the **generic-data-path ingress**: every `*Data` write face in
  `@objectstack/metadata-protocol` routes its response records through the
  single exported helper `omitInternalFieldsFromWriteResponse`, held there by
  a tripwire test that enumerates the ingress surface and fails on any face
  the sentinel reaches (or any new `*Data` face with no recipe). The
  `sys_api_key.key` PATCH-body closure (#7728's fourth surface) is preserved
  at the ingress, byte-for-byte for callers. `@objectstack/rest`'s
  cross-object batch update — the one write mouth outside the protocol —
  applies the same shared strip.
- better-auth's session-lifecycle readbacks (revoke-other-sessions,
  sliding-expiry refresh, expired-session cleanup) read `token` back off
  adapter find results, which the read strip starves — measured:
  `POST /auth/revoke-other-sessions` answered `200 {"status":true}` while the
  other session kept authenticating. The adapter now re-attaches the token
  through `Engine.resolveInternalField` (#8118's privileged batch accessor) —
  no engine carve-out, no second accessor. Plain bearer validation never
  needed the readback and is untouched.

`hidden: true` was never the broken contract (spec defines it as "Hidden from
default UI", never as "stripped from serialization"); the broken contract was the
field's own description.

**Not retyped, deliberately.** `Field.secret` would encrypt at rest and replace
the column with a `sys_secret` ref, destroying the by-token session lookup
better-auth performs on every authenticated request — it would break
authentication in order to fix a disclosure. `Field.password` is inert here: the
read mask skips `password` on `managedBy: 'better-auth'` objects, and it collects
by **TYPE** regardless, which a `text` column never satisfies. Two independent
barriers, so the column stays `text`.

**Storage, filtering and indexing are untouched** — the strip runs on the rows the
driver has already produced, after the predicate has been evaluated and the unique
index on `token` used. The regression proof drives both directions: sessions still
mint, the minted bearer still authenticates (`GET /auth/get-session` ⇒ 200), a
`where: { token }` lookup still resolves the row server-side while that same row
comes back with no `token` key, and revoke-other-sessions / expired-session
cleanup are pinned on the ROW they act on, not the status code that lied.
Without those, a change that simply broke authentication would satisfy every
"absent" assertion.
