---
'@objectstack/plugin-security': patch
'@objectstack/spec': patch
---

fix(plugin-security): the `sys_permission_set` duplicate-name refusal carries `UNIQUE_VIOLATION`, and the packaged-set lock answers first (#19307)

Clause-②: no

Two halves of one defect on the data door's insert leg for `sys_permission_set`
(`permission-set-projection.ts`), both measured live on `examples/app-showcase`
with a seeded admin over a cookie session.

**1. The refusal carried no machine-readable code.** It threw a bare `Error`
with `.status = 409` and no `.code`, and the flat `{ error, code }` responder
invents nothing for a producer that declared nothing, so the client got prose:

```
POST /api/v1/data/sys_permission_set {"name":"dev_local_set"}
→ 409 {"error":"[Security] permission set 'dev_local_set' already exists","object":"sys_permission_set"}
```

ADR-0112's 2026-08-17 amendment closed `error.code` at the flat door too, so a
409 with no code is that contract unhonoured — and a UI that has to branch on
the refusal was pushed back to string-matching. The same request now answers
`409 … "code":"UNIQUE_VIOLATION"`, message byte-identical.

⚠️ `UNIQUE_VIOLATION` is REUSED, not minted. `sys_permission_set` declares
`{ fields: ['name'], unique: 'organization' }`, so this very collision already
answers `409 UNIQUE_VIOLATION` when the index catches it instead of this
pre-check; a second spelling would make one condition answer two envelopes
depending only on which layer got there first. The ledger gains a provenance
row for `@objectstack/plugin-security` — the union, its casing and every other
package's rows are unchanged, and no schema shape moves.

**2. It ran BEFORE the packaged-set lock, so the most likely path answered the
less useful of two true refusals.** A package-declared set has a projected row,
so its name is duplicate AND locked at once. An admin who opened the Clone
dialog on a packaged set and typed the base set's own name — the single most
likely thing to type — got `already exists`, which names no remedy, and never
reached `NOT_OVERRIDABLE`, which names the clone path. The lock now runs first:

```
POST /api/v1/data/sys_permission_set {"name":"showcase_manager"}
→ 403 {"error":"[Security] Permission set 'showcase_manager' is declared by package
   'com.example.showcase' and is locked … Choose a different name for your set, or clone
   'showcase_manager' …","code":"NOT_OVERRIDABLE","object":"sys_permission_set"}
```

**What did NOT move**, measured on the same runtime: an ordinary
(non-package-declared) duplicate still answers the duplicate refusal and not
`NOT_OVERRIDABLE`; an unauthenticated write on the same resource still answers
`401 UNAUTHENTICATED`; and an `update` targeting a packaged set answers
`403 NOT_OVERRIDABLE` exactly as before.

⚠️ **One corner moved with the order**: an ordinary duplicate attempted while no
artifact source can answer now takes the lock's fail-closed `unknown` refusal
(403, "retry once the metadata layer is readable") instead of the 409. Both are
refusals and neither writes; it is pinned so the behaviour is declared rather
than incidental.
