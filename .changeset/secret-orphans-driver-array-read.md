---
"@objectstack/cli": patch
---

refactor(cli): `os secret orphans` reads its drivers as the arrays they return, and the union's driver port says so

`os secret orphans` wrapped both of its driver reads in a local `rowsOf()` that
unwrapped `{ data: [...] }`, lifted a bare row into `[row]`, and filtered out
non-object entries. None of those limbs was reachable. Every concrete driver
that can sit behind `ObjectQL.getDriverForObject()` resolves `find` to an array
on every path it can return on, `[]` included — `SqlDriver` (and
`SqliteWasmDriver`, which extends it without overriding `find`), `TursoDriver`
in both its local and remote faces, `MongoDBDriver` and `InMemoryDriver`, which
are every `IDataDriver` implementation in this tree — and `registerDriver` /
`getDriver` hand the registered instance back unwrapped, so nothing interposes
another shape.

The reason the limb existed is the second half of this change.
`SecretReferenceDriverLike`, the read-only driver port the command borrows from
`secret-reference-union.ts`, declared `find` as `Promise<unknown>` while the
sentence directly above it said it matched `IDataDriver.find` — which declares
`Promise<Record<string, unknown>[]>`. The declaration and its own comment
disagreed, and a caller that cannot see an array in the type writes a
normalizer for envelope shapes no producer emits. The port now states the
contract it always claimed to state, so the two reads are typed as the arrays
they are and need nothing in front of them.

No behaviour changes for any driver that keeps the contract. What changes is
what happens if one ever does not: the command now fails loudly instead of
silently dropping the row, and dropping a `sys_secret` row from this read means
dropping it from the report — which is the one thing this command's safety
property forbids. A driver that answers something other than an array is a
contract violation to fix at that driver, not to absorb here.

The shape is no longer assumed. `orphans.driver-contract.test.ts` boots the
stack this command boots, names the concrete driver it resolves for
`sys_secret` and `sys_setting`, and asserts that a seeded row comes back as a
direct element of a bare array — then runs the command end to end against that
same database and checks that a value from each of the two former call sites
reaches the `--json` report.
