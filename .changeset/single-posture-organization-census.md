---
"@objectstack/plugin-auth": minor
---

fix(plugin-auth): a `single`-posture deployment holding more than one organization is reported at `error` instead of booting silently (#17010)

ADR-0131 §1.2(3) states that its precondition — many organizations with the organization wall inert — 「is today a refused boot」. It is not. A deployment that never REQUESTS a walled posture and simply HOLDS more than one `sys_organization` row under `single` boots, serves, and says nothing: `resolveDefaultOrgId` answers the bootstrap org, else the sole org when exactly one exists, else `null` — silently. The harm then surfaces far away and looks like an unrelated data outage: users reconciled from then on are bound to no organization, a platform admin reads zero rows of every organization-stamped object while analytics still counts them, and system-context writes are refused `ambiguous-organization` by the per-write guard.

The tenancy service now takes a `count(sys_organization)` census on that same seam and reports at `error` when a non-walled deployment holds more than one, naming the posture it DECLARED, the count it HOLDS, and the two ways out: declare a walled posture (`OS_TENANCY_POSTURE=group` / `isolated`, plus the `@objectstack/organizations` package that activates it), or hold one organization and model the sub-units as business units.

**The boot is not refused.** This change only reports; whether the boot should instead be refused stays open for the maintainer, and nothing here has to be undone if that is the answer. The per-write `ambiguous-organization` refusal is untouched.

Cost is one `count()` per process: the census sits downstream of the walled-posture early return (a `group`/`isolated` deployment pays nothing and says nothing) and downstream of the memoized resolution, and an engine that cannot answer stays silent rather than guessing. A healthy install — exactly one organization, or none bootstrapped yet — is silent by construction.
