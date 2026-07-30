---
"@objectstack/cli": patch
---

feat(cli): lint the contradictory uniqueness double-declaration (#3991)

New advisory rule `unique/double-declaration`, reported by `os lint` and
`os build`. It fires when one column carries BOTH a field-level `unique: true`
and an object-level single-column unique index:

```ts
email: Field.email({ unique: true }),           // per-tenant since #3696
indexes: [{ fields: ['email'], unique: true }], // platform-wide, verbatim
```

The two spellings deliberately mean different things (see `IndexSchema`), and
each is legitimate alone. Together on one column they never are:

- On a **tenant-scoped** object they contradict. The stricter one wins
  physically, so the global index enforces uniqueness and the per-tenant
  composite becomes a constraint nothing can trip — one of the two authored
  intents is silently discarded. Worse, it hides the #3696 semantic change:
  the switch from global to per-tenant has *no observable effect* while the
  declared index still enforces the old behaviour, so the author never learns
  their tenancy model and their real constraint disagree — until a second
  tenant reuses the value and is rejected.
- On a **tenancy-less** object they are the same index declared twice.

Tenancy is deliberately not inferred at authoring time (`organization_id` is
injected by the kernel at registration, not authored), so the message names
both readings and the fix spells out the choice: `unique: 'global'` plus
dropping the index for platform-wide, or dropping the index for per-tenant
(or writing it out as `fields: ['organization_id', 'email']`).

A field already declared `unique: 'global'` is exempt — the index restates
that intent rather than losing it. Advisory only: the artifact is well-defined,
so this never fails a build.
