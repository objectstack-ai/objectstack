---
'@objectstack/plugin-auth': patch
'@objectstack/cli': patch
---

Fix: `objectstack dev` now seeds its dev admin on a database that has PEOPLE but no LOGIN

An app that declares `sys_user` rows in `defineStack({ data })` used to lose the
`objectstack dev` login permanently. The declarative seed is awaited inside
`AppPlugin.start()`, so it always landed before the dev-admin seed's own
`kernel:ready` hook; the seed's gate asked "does any human `sys_user` row
exist?" and skipped — on that boot and on every later one, because the rows
survive. The deployment ended up with no loginable account at all: people rows
present, `sys_account` empty, `POST /auth/sign-in/email` returning 401.

A seeded person is a directory row with no credential. It is not a login, and
the gate now says so: the seed acts while no account holds the configured seed
address and no local password login (`sys_account.provider_id = 'credential'`)
exists anywhere. "Never overwrites an existing account" is unchanged and now
covers federated accounts on that address too. A credential store that cannot be
read is its own verdict — the seed declines and says so, rather than minting a
known-credential admin into an environment it could not see.

The seed's own provisioning call is now admitted as what it is — the
deployment's own boot command provisioning its admin — instead of riding on the
audience gate's zero-human bootstrap bypass, which the app's people seed also
answers "populated". The public self-registration door is unchanged: nothing
outside the process can stage that declaration, it names one address, and it is
cleared as soon as the call returns.

`GET /api/v1/auth/bootstrap-status` now answers with the same bootstrap-window
question the admission gate asks, instead of counting `sys_user` rows with no
filter. On a database still carrying the legacy `usr_system` service row it used
to report `hasOwner: true` while the admission gate and plugin-security's
first-user detection both stood ready to admit and promote the first human — so
the console withheld a first-run setup flow the platform would have accepted.
