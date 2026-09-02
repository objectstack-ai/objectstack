---
'@objectstack/types': minor
---

fix(types): `isMissingTableError` prefers the table a driver declared it targeted over the caller-supplied `readObject` — new `DRIVER_TARGETED_TABLE` / `declareTargetedTable` / `targetedTableOf` (#13438)

`minor` because the public entry gains three exports; the predicate's signature
`(error, readObject?)` is **unchanged**, and every existing caller compiles and
behaves as before unless the error it holds carries a declaration.

**The residual #13324 left behind.** `readObject` lets a caller say which table it
read, so a phrase naming a *different* relation no longer earns the benign "not
provisioned yet" verdict. But a caller names its **object**, and a driver compiles
the statement against the **physical** table — for a federated object (ADR-0015,
`external.remoteName`) two different names. A genuinely absent remote therefore
raised a phrase naming `legacy_orders` against a caller naming `crm_order`, and the
comparison read a real missing table as loud. The mapping lives on the driver
instance; no call site can fold it away.

**The channel (maintainer ruling 2026-09-01, option 2).** A driver that knows the
table it targeted declares it on the error it composes:

- `DRIVER_TARGETED_TABLE` — `Symbol.for('objectstack.driver.targetedTable')`, the
  well-known key, from the global registry so a duplicated package resolves it;
- `declareTargetedTable(error, table)` — the producer's half: defines the name
  **non-enumerable and non-writable** (invisible to `JSON.stringify`, `{ ...err }`,
  `Object.keys`), first declaration wins, an empty or non-string name declares
  nothing;
- `targetedTableOf(error)` — the reading half, `string | null`.

`isMissingTableError` now compares the phrase against the **declared** table at
any node of the `cause` chain that carries one — the nearest declaration to the
dialect phrase wins — and ignores the caller-supplied `readObject` from that node
down. Without a declaration the comparison is the #13324 one, byte-for-byte. The
callers stay as they are: `crm_order` is still what they pass, and they never
learn a federated object's remote name.

**Two consequences, both pinned.** A genuinely absent federated remote reads
benign again. And because a declaration is evidence the caller did not have, an
envelope whose phrase names a relation *other* than its declared table reads
**not benign even through the one-argument published form** — the #13324 verdict,
reached without the caller's help, in the direction the module docblock calls
cheap (one error line, never silent data loss). The #13324 narrowing itself does
not reopen: a different relation's error — a view over a dropped base, a join
target, a `sys_*` table hit inside the same statement — stays loud with the
declaration present, on every dialect fixture the existing pins carry.

`@objectstack/driver-sql` adopts the channel in the same release; the pattern is
one call at any future driver's envelope. `isSchemaAlreadyExistsError` is
untouched.
