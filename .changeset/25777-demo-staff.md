---
'@objectstack/spec': minor
'@objectstack/plugin-auth': minor
'@objectstack/runtime': minor
'@objectstack/cli': minor
---

feat: `demoStaff` — an application declares the demo accounts its seed data is dealt to, and the development boot creates them

Clause-②: yes
Metadata-protocol: added

A stack may now declare `demoStaff: [{ name, email, position?, permissionSets? }]`. On a local development boot (`os dev`), `@objectstack/plugin-auth` creates each entry right after the development admin, through the same sign-up pipeline, with the development seed password (`os dev --admin-password`, default `admin123`); assigns the declared position and permission sets in the Default Organization (an account the membership policy left outside it is reported and gets none); and the application's seed then runs, so a seed row naming one of these people (`owner_id: 'Legal Counsel 1'`) resolves on the first boot. Idempotent: an address that already has an account is left exactly as it is, and only its missing assignments are added.

Development only. `os build` leaves the key out of the artifact (`objectstack.json`), so a deployment booted from one has nothing to provision. Every other boot creates nothing and says why, with an ADR-0112 code: a boot that is not `NODE_ENV=development`, or a migrate-and-exit run (`PERMISSION_DENIED`, logged at `info` — the intended outcome there); and, on a development boot, logged at `warn` because the developer loses the accounts: a walled tenancy posture or an auth base URL that is not a loopback address (`PERMISSION_DENIED`), a database where nothing but a demo account could sign in, so a demo account would be promoted to platform admin (`PRECONDITION_REQUIRED`), or a credential store that could not be read (`SERVICE_UNAVAILABLE`).

`defineStack` refuses an entry that names a position or permission set the stack does not declare (a platform set such as `admin_full_access` is never one), and two entries with one name or one address (`STACK_CROSS_REFERENCE_INVALID`).

`@objectstack/runtime`: when the boot will create demo accounts, `AppPlugin` runs its inline seed at `kernel:bootstrapped` instead of inside `start()`. The seed source is declared as before, so the settlement tally and `app:seeded` behave as they do for a seed that overran its budget.

What to do: nothing. A stack that declares no `demoStaff` boots, seeds and builds exactly as before. An application that creates its demo accounts with its own script can declare them here and delete the script.
