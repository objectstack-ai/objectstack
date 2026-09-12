---
"@objectstack/platform-objects": minor
"@objectstack/plugin-auth": minor
"@objectstack/client": minor
"@objectstack/cli": minor
"@objectstack/spec": minor
---

feat(auth)!: adopt better-auth's account-issuer rollback — drop `sys_account.issuer`, retire the backfill, lift the `@better-auth/*` family to an exact `1.7.3` (#17440)

<!-- adr-0087: registered sys-account-issuer-retired -->

**BREAKING** — a platform object drops a declared field and `@objectstack/plugin-auth`
drops six published symbols. Shipped as `minor` under the launch-window convention
(`major` is refused by `check-changeset-no-major`; breaking-ness is carried by this
banner plus the ADR-0087 disposition above). The hand-migration prescription is
registered under protocol major 18 as `sys-account-issuer-retired`.

better-auth `1.7.3` removed the issuer-scoped account identity outright
(`better-auth/better-auth#10909`): `createLocalAccountIssuer` is deleted,
`accountSchema.issuer` is gone, `AccountKey` is `(providerId, accountId)` again, and the
`account.issuer` column and its unique index are gone from `get-tables`. There is no
drop-in replacement. `#16186` pinned the family at an exact `1.7.2` as a stopgap; this is
the durable half, per the maintainer ruling of 2026-09-10 on `#16629`.

## 迁移:FROM → TO

| FROM | TO | the one-line fix |
|:--|:--|:--|
| `sys_account.issuer` (column + `{ fields: ['issuer','account_id'], unique: true }`) | — | nothing replaces it; identity is `(provider_id, account_id)`, declared UNIQUE on `sys_account` since the object was created |
| reading `account.issuer` off a row or off `client.accounts.list()` | `sys_sso_provider.issuer`, resolved through the account's `provider_id` | `provider_id` is unique per environment, so it names the authority on its own |
| `backfillAccountIssuer(ql, …)` | — | delete the call; there is no successor pass |
| `CREDENTIAL_ISSUER` / `oauthIssuerFor(id)` | — | drop the argument; `internalAdapter.createAccount({ userId, providerId, accountId, password })` takes no `issuer` |
| `ResolvedSocialProvider`, `BackfillAccountIssuerOptions`, `BackfillAccountIssuerResult` | — | delete the import; the compiler names every site |
| `@better-auth/*` at an exact `1.7.2` (eleven members) | an exact `1.7.3` (eleven members) | the family moves as ONE line — `@better-auth/core@1.7.2` and `@better-auth/kysely-adapter@1.7.3` are mutually incompatible in both directions |

## ⭐ Existing deployments: run the pre-flight BEFORE the column is dropped

Uniqueness moves from `(issuer, account_id)` to `(provider_id, account_id)` — a
**narrower** key. Two rows sharing `provider_id` + `account_id` and differing only in
`issuer` are legal under the old key and are ONE account under the new one.

```
os migrate account-issuer          # read-only; exits non-zero when the drop must not proceed
# … take a backup (the operator's act, and the apply step's precondition) …
os migrate apply --allow-destructive
os migrate account-issuer          # post-check: reads zero
```

The pre-flight reads **rows**, never the index declaration. `syncDeclaredIndexes` logs a
plain UNIQUE whose CREATE failed on existing duplicates onto the durability channel and
lets the boot continue (`#14902` / `#15479`), so a database can carry the declaration
without the constraint — and on such a database the drop does not fail loudly, it
degrades silently: the rows become indistinguishable and a sign-in can resolve onto the
wrong user's account. `os migrate apply --allow-destructive` re-runs the same pre-flight
and refuses the drop before writing any DDL. A read that throws, or a scan that
truncates, refuses too — an unread table is not a clean one.

⛔ Colliding rows are never merged or dropped for you: which row survives is application
knowledge, and two different people can be behind one colliding key. Keep the row whose
provider account is live, delete the rest so a fresh sign-in re-links, and re-run.

The boot refusal is unchanged and needs no new machinery: a runtime already refuses to
start against unapplied destructive drift, naming the command to run, and never
auto-migrates.

## ⚠️ A `provider_id` re-pointed at a different IdP must have its bindings REBUILT

This is the one case `issuer` still discriminated. After the drop no column records which
IdP vouched for a row, so if a re-pointed provider's new IdP mints a subject the old one
had already issued to somebody else, the key resolves that sign-in onto the other
person's account. Under the old key that failed loudly (`unable_to_link_account`); under
the new one it is silent.

⇒ `sys_sso_provider` now **refuses an `issuer` change while `sys_account` rows are still
bound to that `provider_id`** (`RESOURCE_CONFLICT` / 409). Delete the provider's account
bindings first; each user re-links on their next sign-in.

## Why the column was a liability, not an asset

A credential row whose `issuer` was not the local credential issuer was invisible to
`findAccountByKey`, so sign-in failed `INVALID_EMAIL_OR_PASSWORD` behind a "User not
found" warn pointing at the `sys_user` row rather than at the account. **Four checklist
items had that recorded as a knownGap, each rediscovering it.** Its discriminating power
here was near zero anyway: `sys_sso_provider` declares `{ fields: ['provider_id'], unique:
true }`, so `provider_id → issuer` is a function within an environment.

## Also in this change

`pnpm check:vendor-export-contract` (from `#16186`) keeps its exactness requirement and
still resolves every named symbol — its self-test re-anchors from the now-retired
`@better-auth/core/db` specimen onto a live edge, and gains a case asserting the two
deleted names are imported nowhere. `#11627`'s hash-shadow-key machinery is untouched: it
is a generic driver capability serving five UNIQUE members of the >768-char class.
