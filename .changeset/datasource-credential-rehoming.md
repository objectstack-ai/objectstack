---
"@objectstack/service-datasource": minor
---

feat(service-datasource): operator-initiated re-homing of stored cleartext datasource credentials into `sys_secret` (#8155)

A datasource row created before #8078 closed the write door can still hold its
credential in cleartext inside `config`. #8081 and #8154 closed the read paths so
none of it is SERVED; neither removes what is already at rest. This adds the
migration that does — `IDatasourceAdminService.migrateCredential(name)`, reached
from the Setup action **"Move credential to the secret store"** on a datasource
record, backed by `POST /api/v1/datasources/:name/migrate-credential`.

**Per datasource, initiated by an operator, never a sweep.** There is no batch
spelling of the route, deliberately: deciding a stored secret's identity with no
operator present and rewriting rows at boot is the destructive shape the standing
ruling escalates rather than permits. The inventory is free and already exists —
`/meta` badges every affected row `_diagnostics: { valid: false }`, so the
operator works from a list the platform already computes, and it shrinks visibly
as each row is done.

**Durability ordering.** The secret is written to the store, **read back and
compared**, and only then does a single record write add
`external.credentialsRef` and drop the inline key together. A crash before that
write leaves the row untouched and working on its inline credential; a crash
after it leaves a row referencing a secret this run already proved readable. A
failed read-back or a failed record write unbinds the secret it just minted
rather than orphaning it. It deliberately does NOT write the ref in one step and
delete the key in a second: the connect path is fail-closed on a `credentialsRef`
it cannot resolve (ADR-0062 D3) and never falls back to `config`, so a row
carrying an unverified ref beside its cleartext is not a safe intermediate state.

**Idempotent.** A row that already references a secret is never bound again — a
re-run answers `already-bound`, writes nothing, and mints no second `sys_secret`
row. A row holding both a ref and an inline copy (an interrupted run, or a wizard
re-entry, whose redacted round-trip carries the stored credential forward by
design) has the copy dropped against the ref it already has.

**What it refuses, and what it tells the operator instead.** Only the key a
driver's own contract declares as its inline credential slot is re-homed —
`password` for postgres/mysql/mongodb, `authToken` for turso — because that is
exactly the key the injected secret substitutes at connect time. Everything else
is refused with a reason and a remedy rather than guessed at: a credential
embedded in a connection URL (the mysql and mongodb DSN branches hand the URL to
the client verbatim and drop the injected secret, so re-homing it could leave the
datasource connecting unauthenticated), a pre-#8078 alias spelling that no
connection builder reads, turso's still-writable `encryptionKey`, a code-defined
datasource, and a host whose secret binder cannot read a secret back. Nothing is
deleted that was not re-homed, and credential-shaped keys left behind are named
in the result so "migrated" never reads as "this row is now clean".
