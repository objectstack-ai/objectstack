---
'@objectstack/metadata-protocol': patch
---

Seed loader: a composite `externalId` no longer puts a raw NUL byte in a
diagnostic line.

`SeedLoaderService` joins a composite natural key's parts with U+0000 on
purpose — that byte cannot occur in a natural-key value, so `('a','b')` and
`('a\0b','')` never collide. The map key is unchanged. What changes is that
the key string is no longer interpolated into human-readable messages: the
`Failed to write <object> record #N (<fields>=<value>)` parenthetical and pass
2's `on record '<value>'` lines now render a composite value as a JSON array of
its parts (`(employer+user=["emp-1","usr-2"])`).

A single-field `externalId` renders byte-identically, so non-composite
diagnostics do not move, and the structured `errors[].attemptedValue` still
carries the real key.

Why it mattered: one raw NUL makes `grep` classify the whole server log as
binary, so every later `grep -n` / `grep -c` over it silently returns nothing
until the reader adds `-a` — the reader's main instrument disabled by one byte,
at the moment someone is diagnosing a failed boot.
