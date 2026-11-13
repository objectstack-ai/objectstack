---
'@objectstack/cli': patch
---

fix(cli): `os migrate apply` lists the runtime-owned index its flush builds before the `[y/N]` prompt

Clause-②: no
Metadata-protocol: none

After the operator confirms, `os migrate apply` performs the held-back schema DDL and then builds the permission-set grant's package-less guard (`sys_user_permission_set.uniq_sys_user_permission_set_packageless`). The prompt listed the held-back work and the drift but not that index, so it under-reported one DDL statement the confirmed run then sent. Apply now prints the same "Runtime-owned indexes" section `os migrate plan` prints, in the same place: after the held-back work and before the drift, the order the apply performs them in. A guard that already stands is not listed, because apply sends it no DDL. The `--json` document and the change count are unchanged.
