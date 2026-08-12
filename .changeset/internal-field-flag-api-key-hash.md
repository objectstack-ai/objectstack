---
"@objectstack/spec": minor
"@objectstack/objectql": minor
"@objectstack/platform-objects": patch
---

feat(spec): `internal: true` — a field whose value is never returned on the generic data path, applied to `sys_api_key.key` (#7728)

<!-- adr-0087: not-required (no-migration-prescription) Purely additive: one new
optional field-level key. Nothing is renamed, retired or tombstoned, so there is
no conversion to register and no consumer action to prescribe. The only
behavioural change is that a field which already DECLARED it was never exposed
stops being exposed. -->

`sys_api_key.key` — the stored **SHA-256 hash** of an API key — declared
`description: 'Hashed API key value — never exposed to clients'` and then
serialized anyway. Measured on a real engine at `origin/main`, the hash came back
on **four** surfaces: get-by-id, list, an explicit `?select=id,key` projection,
and the `PATCH` 200 body.

`hidden: true` was not the broken contract — spec defines `hidden` as "Hidden
from default UI", never as "stripped from serialization". The broken contract was
the field's own description, and there was no mechanism to honour it.

**Why no existing mechanism fit.** ADR-0100 names three credential channels, and
the third — the auth subsystem's one-way hashes, which live in ordinary `text`
columns — had no read protection at all. The engine's credential mask collects by
field **TYPE** (`collectMaskedReadFields` walks for `secret` / `password`), so a
`text` column is collected by nothing, *regardless* of `managedBy`; the
better-auth exemption is the second barrier, not the first. Retyping is not
available either: `Field.secret` encrypts at rest and replaces the column with a
`sys_secret` ref, which destroys the `where: { key: hashApiKey(raw) }` lookup the
API-key verifier depends on — it would break authentication in order to fix a
disclosure — and `Field.password` is defined as *plaintext at rest*, which a
one-way hash is not, so adopting it would swap one false declaration for another.

**The new flag.** `internal: true` is an opt-in, type-independent field
declaration meaning *the declared value is never returned on the generic data
path*. The engine omits the key from the rows it hands back at the four post-hook
positions the `__search` companion strip (#7642) already occupies: `find`,
`findOne`, the 201 create body and the by-id update body.

**Omission, not masking.** The credential mask signals "a value is set" without
leaking it. `key` is `required: true`, so it is always set — the signal carries
zero bits here, while still shipping a value under a field whose declaration
promises none. Omitting also leaves the description string untouched, so the four
generated translation bundles that mirror it do not churn.

**`?select=` is closed by construction, and that half is load-bearing.** The strip
acts on the result rows rather than on the projection, so a client that spells the
column out gets a 200 without it. `select` only gates on whether a field is
*known*, and a flagged column is known — a projection-aware strip would have
shipped looking complete while leaking to anyone who named the column.

**What is deliberately untouched**, because the flag would be unusable otherwise:
storage and encryption; filtering and indexing, so the verifier's hash lookup
still resolves a principal (the strip runs *after* the driver has evaluated the
predicate); and the show-once mint path — `POST /api/v1/keys` still returns the
raw secret exactly once at creation.

Unlike its sibling `stripSearchCompanionFromRead`, this strip has **no
system-caller carve-out**. That one keeps the `__search` column for a system
reader that names it by projection, because it has such a reader whose backfill
would otherwise rewrite every row on every run. This flag has none: the verifier
uses the column as a filter and never reads it off the result, and the mint path
returns the plaintext it generated rather than the row it inserted. An escape
hatch nobody needs is a hole in a non-exposure guarantee.

Scope is one declaration site. `sys_session.token` is tracked separately as #7823
and `sys_account.password` is a later card; neither is adopted here.
