---
'@objectstack/cli': patch
'@objectstack/runtime': patch
---

fix(cli, runtime): the 18.0 operator messages say that 18.0 supports fresh `single` installs only

Clause-②: no

- **The v18 boot refusal on a v17-shaped database** now says first that 18.0 does not upgrade a v17 database: keep it on a 17.x release until the 18.x release that carries the upgrade path. Before, it named only `os migrate organization-ownership`, which refuses in 18.0 as well, so the operator reached the answer in two hops.
- **The fix list for an unrecognized `OS_TENANCY_POSTURE`** (printed by `os serve` and `os doctor`) still lists `group` and `isolated`, and now says beside each that 18.0 refuses it at boot.
- **`os doctor` reports a walled posture.** Under `group` or `isolated` it prints a `Tenancy posture` warning: 18.0 supports `single` only, so the next `os serve` (and so `os dev` and `os start`) refuses the posture at boot. The row is a warning, so doctor's exit code does not change. Before, doctor printed nothing about a valid posture.

Nothing else changes. The refusals themselves, their codes and their exit codes are as before.
