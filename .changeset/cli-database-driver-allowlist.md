---
"@objectstack/cli": patch
---

fix(cli): `--database-driver mysql` and `--database-driver sqlite-wasm` are no longer refused before the command runs (#6860)

`--database-driver` on `os start` and `os dev` is declared with oclif's `options:`,
which is an **enforced allowlist** rather than a help string: a value outside it is
rejected during flag parsing, before the command body executes. That allowlist read
`sqlite | turso | postgres | mongodb | memory` and omitted `mysql` and `sqlite-wasm`
— two drivers `resolveStorageDefinition` resolves and the `OS_DATABASE_DRIVER` env
var selects without complaint.

So the CLI gave one question two answers:

```
$ os start --database-driver mysql
 ›   Error: Expected --database-driver=mysql to be one of: sqlite, turso,
 ›   postgres, mongodb, memory                                        # exit 2

$ OS_DATABASE_DRIVER=mysql os start
🗄️ Database: mysql://127.0.0.1:3306/osdb                              # boots
```

The refusal came out in oclif's generic vocabulary, not in anything this repo
wrote, so it read as "ObjectStack has no MySQL driver" rather than "this flag's
list is stale" — and the operator's next move (drop the flag, export the env var)
is not one the message suggests. Both commands were affected; the flag is declared
once in `start.ts` and once in `dev.ts`.

Both kinds are now offered by both commands, and the help text and the two
`content/docs/deployment/cli.mdx` flag tables list the set actually accepted (the
`OS_DATABASE_DRIVER` row in `environment-variables.mdx` already did).

A new pin, `database-driver-allowlist.pin.test.ts`, asserts the **agreement**
between the flag's allowlist and the driver kinds `resolveStorageDefinition`
produces, deriving both sides from the code that owns them rather than restating a
list — a hard-coded expectation would only relocate the divergence into the test,
leaving a future driver missing from the flag and from the test at once. It covers
both commands, because the duplicated declaration is exactly how they can drift.

**Patch, not minor:** no driver is added here. `mysql` and `sqlite-wasm` already
worked and were already reachable through `OS_DATABASE_DRIVER`; what was broken was
the parity between two equivalent entry points to the same capability. The change is
strictly widening — every invocation that parsed before still parses identically —
so there is nothing to migrate.

Note for #6345: this deliberately does not converge the driver vocabulary. The
resolver still accepts aliases (`pg`, `mysql2`, `libsql`, `mingo`, `wasm`, …) that
the flag does not offer, and the pin is written so that stays true — an alias
collapses to its canonical id and is not demanded of the flag. Deriving the
allowlist from a shared alias table remains #6345's work, and will refactor these
lines away.
