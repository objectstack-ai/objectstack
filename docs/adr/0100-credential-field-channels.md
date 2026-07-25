# ADR-0100: Credential Field Channels — `secret` (encrypted) and `password` (masked)

- **Status**: Accepted
- **Date**: 2026-07-18
- **Issue**: #2036 (found via #2033 / #2025 / #2028 field-type round-trip work)
- **Relates to**: ADR-0077 (authoring-surface boundary), ADR-0078 (no silently
  inert metadata), ADR-0069 (enterprise authentication hardening)

This ADR unifies the two credential-bearing field types under one record. The
`secret` channel had shipped without its own ADR — code comments referenced a
"secret field channel" ADR that never existed; this document is that home. The
`password` masking decision (#2036) is the new material and is documented
alongside it, because the two types share the read mask and only make sense when
contrasted.

## Context

ObjectStack has three places a credential can live, and they must not be
confused:

1. **`secret`** — a reversible machine credential (DB password, API key, token)
   authored on any object. Already implemented: encrypted at rest, masked on
   read, decryptable only through a privileged path.
2. **`password`** — a field type authors reach for on custom objects. Its
   *intended* association (one-way hashing) belongs to the auth subsystem, but a
   `password` field on a **non-auth** object never touched that subsystem.
3. **Auth-subsystem credentials** — better-auth's identity tables
   (`sys_account.password`, a hashed `text` column), one-way hashed off the
   generic CRUD path entirely.

The bug (#2036): a `password`-typed field on a non-auth object (e.g.
`showcase_field_zoo.f_password`) round-tripped **plaintext** through the generic
CRUD engine — neither hashed nor masked. This is a low-code platform where field
types are author-driven (often by an AI); someone modeling a `password` field
reasonably expects credential-grade handling and silently got plaintext storage
and plaintext reads, a runtime/security trap the static gates do not catch.

The issue framed four options: (1) mask on read like `secret`; (2) hash on write
in the generic path; (3) an author-time guard; (4) document as auth-only. Option
2 is the wrong fit — one-way hashing only makes sense for credential
*verification*, which a non-auth object never does, and doing it in the engine
would stand up a second, unmanaged credential store that violates the
"auth subsystem owns credentials" boundary. Option 4 leaves the silent trap in
place. This ADR adopts **1 + 3** for `password`, and records the pre-existing
`secret` channel it now sits beside.

## Decision

### A. The `secret` channel (records existing behavior)

A `secret` field is **reversible and encrypted at rest**:

- **Write** — the plaintext is wrapped by the registered `ICryptoProvider`,
  persisted as a `sys_secret` row, and replaced on the business row by an opaque
  `secret:<id>` ref. Cleartext never reaches the business table.
- **Read** — the ref is masked to `SECRET_MASK` (`••••••••`) on the generic path
  (`find`/`findOne`/`$expand`); an unset secret reads back `null`.
- **Fail-closed** — writing a secret value with no `CryptoProvider` registered,
  or no reachable `sys_secret` store, THROWS rather than persist cleartext.
- **Privileged read** — `resolveSecret(ref)` is the only sanctioned way back to
  plaintext (e.g. a datasource connection binder); it is never on the generic
  read path.

### B. The `password` channel (new, #2036)

A `password` field on a generic (non-`better-auth`) object is **plaintext at
rest but masked on read**:

1. **Masked on read** — masked to `SECRET_MASK` in `find`/`findOne` (and
   `$expand`, which re-enters `find`), exactly like `secret`.
2. **Plaintext at rest, by design** — **not** encrypted, **no** `sys_secret`
   row, **no** `CryptoProvider` required. Masking is a read-path transform only.
   This keeps the change minimal and avoids a second credential store. Authors
   who need reversible encryption-at-rest should use `secret`.
3. **Echoed-mask write guard** — because a read now returns `SECRET_MASK`, a
   client that reads a record and PATCHes it back would otherwise overwrite the
   stored value with the literal mask. The write path drops any masked field
   (secret or password) whose incoming value equals `SECRET_MASK`, so an
   unchanged round-trip is a no-op. Accepted cost: the literal string
   `••••••••` cannot itself be stored as a password via an echoing client.
4. **`managedBy: 'better-auth'` exemption** — the auth subsystem reads its
   identity rows *through* the engine's `find`/`findOne`, so masking a credential
   column there would break login. Objects marked `managedBy: 'better-auth'` are
   exempt from password masking. Today this is a safety net, not load-bearing:
   no shipped identity object even declares a `password`-typed field
   (`sys_account.password` is a hashed `text` column), pinned by a
   platform-objects test so retyping it becomes a deliberate decision.
5. **Non-fatal author-time warning (ADR-0077/0078)** — `ObjectSchema.create()`
   emits a `console.warn` (deduped per object name) when a `password` field is
   declared on a non-`better-auth` object, steering authors to `Field.secret`
   for reversible machine credentials or to the auth subsystem for login
   credentials. It is a *warning*, not a build error: `password` now has a
   defined generic-path contract (so ADR-0078 does not compel an error), and the
   field-zoo example intentionally exercises every field type — a hard error
   would be self-inflicted breakage. Raw `.parse()` stays silent, since it also
   loads persisted metadata and `create()` is the authoring surface (ADR-0077).

   **Opt-out — `ackPlaintextMasking: true` (#3420).** A deliberate `password`
   field (like field-zoo's `f_password`) can affirm intent with a field-level
   `ackPlaintextMasking: true`; the warning then skips that field. The original
   text said the warning was "safe to ignore" but offered no way to *express*
   that intent, so the official showcase booted with an unavoidable warning —
   training users to ignore warnings. The flag is the documented affirmation and
   lets the stock example start warning-free. It is diagnostic-only: masking,
   the echoed-mask guard, and the better-auth exemption are all unchanged by it.

### C. Shared mechanism

Both channels share one read-mask collector — `collectMaskedReadFields`
(`packages/objectql/src/secret-fields.ts`): every `secret` field, plus every
`password` field on a non-`better-auth` object. `maskSecretFields` (read) and the
echoed-mask drop (write) in `engine.ts` both consume it, so the better-auth
exemption lives in exactly one place. `SECRET_MASK` is the single mask constant
for both.

## Consequences

- Edit forms that prefill from a read now show the mask for `password` fields —
  identical to the existing `secret` UX. Unchanged-value saves are protected by
  the echoed-mask guard (B3).
- The generic read path no longer leaks credential plaintext for `password`
  fields; the field-zoo HTTP round-trip pins this (`f_password` upgraded from
  `present` to `masked`).
- The dangling "secret field channel" references in `field.zod.ts` and
  `secret-fields.ts` now resolve to this ADR.

## Non-goals / follow-ups

- **`aggregate()` masking gap.** `aggregate()` masks neither `secret` nor
  `password` — a pre-existing gap for `secret`. Post-hoc masking of aggregate
  output would corrupt group keys; the correct fix is to *reject* aggregations
  that reference a credential field. Tracked in #3171, not addressed here.
- **Hashing / verification for authored `password` fields** — explicitly out of
  scope (B2). Credential verification belongs to the auth subsystem.
