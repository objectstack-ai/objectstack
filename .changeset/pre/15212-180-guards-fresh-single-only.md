---
'@objectstack/cli': minor
---

feat(cli)!: 18.0 supports fresh `single` installs only — `os migrate organization-ownership` refuses, and `os serve` refuses a walled posture at boot

Clause-②: yes (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) Nothing an author writes, and no stored shape an author owns, is added, removed, renamed or converted: a CLI command and two deployment postures that used to run now refuse, with no spec key, export, config field or error code removed or renamed. The remedy is an operator's one, stated below: stay on 17.x, or run 18.0 under `single` on a fresh database. -->

**BREAKING** (a command and a boot posture that used to run now refuse), shipped as `minor` under the launch-window convention for breaking changes. 18.0 supports fresh installs under the `single` tenancy posture only; upgrading a v17 database and the walled postures arrive in an 18.x release.

- **FROM** `os migrate organization-ownership` (plan) and `os migrate organization-ownership --apply …` running the v18 ownership ceremony **TO** both refusing with exit `1` and the standard code `NOT_IMPLEMENTED` (under `--json`: `{ error: 'plan_refused' | 'apply_refused', reason: 'upgrade-unavailable', code: 'NOT_IMPLEMENTED', detail }`), reading and writing nothing. The 18.0 ceremony is knowingly incomplete, and an incomplete ceremony must never certify an old database. **Fix:** keep a v17 database on a 17.x release until the 18.x release that carries the upgrade path. `os dev`'s in-place upgrade of a v17 development database runs this command, so it now stops with the same refusal and changes nothing.
- **FROM** `os serve` (and so `os dev` and `os start`) booting with `OS_TENANCY_POSTURE=group` or `isolated`, or with `OS_MULTI_ORG_ENABLED=true`, **TO** a FATAL refusal at the tenancy-posture gate, exit `1`, naming `NOT_IMPLEMENTED` and the 18.x release, before a config is read. `OS_ALLOW_DEGRADED_TENANCY` does not lift it, and no flag or variable does. **Fix:** set `OS_TENANCY_POSTURE=single` (or unset it and `OS_MULTI_ORG_ENABLED`), or keep a walled deployment on a 17.x release.

**What stays as it was.** A fresh install under `single` boots exactly as before. The boot guard that refuses a v17-shaped database is unchanged. Kernel-level boots (`@objectstack/verify`'s `bootStack`, embedded hosts) still accept every posture.
