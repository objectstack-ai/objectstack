---
'@objectstack/spec': patch
---

docs(spec): `demoStaff` and `devLogins` prose state what a seeded `sys_user` row really does, and `devLogins` points at `demoStaff`

Clause-②: no
Metadata-protocol: none

- **Before.** `DemoStaffSchema`'s TSDoc said a `sys_user` row written through `data` is refused (ADR-0092). It is not: every seed write runs under the system execution context, which the identity-write guard stands aside for, so the row lands. `DevLoginSchema` told the author to "seed the account itself in `data`" in its prescriptions for the `permissions`, `capabilities` and `seed` keys, and its header and `email` description assumed the application seeds the account. Following that lands a directory row with no credential, which cannot sign in.
- **Now.** The `demoStaff` TSDoc says the row lands as a directory row with no account and cannot sign in. The `devLogins` prescriptions, header and `email` description tell the author to declare the person in `demoStaff`, so that `os dev` creates an account that can sign in. The regenerated `references/system/dev-login.mdx` carries the new `email` description.
- No schema, key or behaviour changes. Only prose and a refusal prescription's wording change.
