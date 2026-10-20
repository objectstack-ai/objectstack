---
'@objectstack/cli': minor
---

feat(cli): `os serve` (and so `os dev` and `os start`) boots a walled tenancy posture again; `group` and `isolated` are supported on fresh installs

Clause-②: yes (widening)

18.0 refused a walled posture at boot, because the walled half of the platform-object organization rule had not shipped. It ships in this release (see the `@objectstack/objectql` changeset on walled system inserts), so the refusal is removed.

- **Before.** With `OS_TENANCY_POSTURE=group` or `isolated`, or `OS_MULTI_ORG_ENABLED=true`, `os serve` exited `1` with a FATAL `NOT_IMPLEMENTED` before it read a config. `os doctor` printed a `Tenancy posture` warning saying so, and the unrecognised-posture fix list marked both walled values as refused in 18.0.
- **Now.** A walled posture boots like `single`, under the same prerequisites as before 18.0: the enterprise `@objectstack/organizations` runtime, and `OS_PLATFORM_OWNER_EMAIL`. `os doctor` reports no row for a valid posture, and the fix list offers `group` and `isolated` without the 18.0 note.
- **Unchanged.** An unrecognised posture is still refused at boot. Upgrading an existing database still waits for the upgrade ceremony, which still refuses in this release.
