---
"@objectstack/lint": patch
---

fix(lint): the three write-set rule messages now state the refusal authors actually get, not a retired driver split (#13858)

Message text only. Rule ids, severities, match sets and hints are untouched, and
no finding changes shape — but a lint's own header states why the prose is
governed: *"a lint that misdescribes the failure it is warning about teaches the
wrong debugging instinct"*. These three sentences did.

`validate-hook-body-writes` (the `ctx.api` branch), `validate-action-body-writes`
and `validate-flow-node-writes` all told the author that an undeclared write has
a **driver-dependent** outcome:

> on a SQL driver the whole call then fails with a driver-level error far from here; on a schemaless driver (memory, MongoDB) the stray key is persisted

For the paths those three rules judge, that has not been true since the
declared-field door landed (#8682 insert, #8738 update). All three describe a
write whose payload is **caller-supplied**, not a mutation of an in-flight
`ctx.input`: `ctx.api` is a `ScopedContext` over the running engine, and a flow
node hands its `fields` map to the data engine directly. The door refuses a
caller-named undeclared key from the object's field map **before any statement is
built**, so no driver is reached and there is no split to observe.

Measured before the prose was rewritten — all three paths, both driver families,
through a real QuickJS sandbox, a real `ObjectQL` engine, the real
`AutomationEngine` with the real builtin CRUD node executors, real
`@objectstack/driver-sql` (better-sqlite3) and real `@objectstack/driver-memory`:

| path | driver-sql | driver-memory |
|---|---|---|
| hook body `ctx.api.object(x).update({…})` | `INVALID_FIELD` / 400 | `INVALID_FIELD` / 400 |
| action body `ctx.api.object(x).update({…})` | `INVALID_FIELD` / 400 | `INVALID_FIELD` / 400 |
| flow `create_record` / `update_record` `fields` | `INVALID_FIELD` / 400 | `INVALID_FIELD` / 400 |

Every run answered `Unknown field 'stagee' on object 'deal'`; nothing was stored
on either family, and the schemaless family kept **no** shadow column — the half
the old message promised and the runtime no longer delivers.

The three messages now name that refusal in the vocabulary the `ctx.input`
sibling landed with (`REFUSED at run time — INVALID_FIELD / 400, identically on
every driver`), say why the door and not a driver answers, and keep each path's
own blast radius: the hook refusal fails the operation that triggered the hook,
the action refusal fails the action, and the flow node's refusal is whole — the
correctly named fields in the same payload never land either, `create_record`
never creates the row, and the step fails the run. That last clause is why the
flow rule still gates at `error`; the severity is unchanged.

`unprovisionedAnchorWriteConsequence()` in the same files is **untouched**: an
ADR-0015 external object's injected anchor *is* declared in the registered
schema, so it passes the door by construction and the remote database really is
what refuses it. That message was already correct.
