---
'@objectstack/cloud-connection': patch
---

feat(cloud-connection): the install door's declared-rename planner is reachable read-only on a kernel service

Clause-②: yes (widening) — a new read-only kernel service, `marketplace-install-rename-planner` (`INSTALL_RENAME_PLANNER_SERVICE`), registered by `MarketplaceInstallLocalPlugin` beside its install door, and new root exports of `@objectstack/cloud-connection`: the service name, its contract (`InstallRenamePlanner`, `InstallRenamePlanRequest`, `InstallRenamePlan`, `InstallRenamePlannedCarry`) and the result types (`InstallRenameCarry`, `InstallRenameRefusal`, `InstallRenameRefusalReason`). Nothing is narrowed: the install door answers every request as before.
Metadata-protocol: none

A host that installs a package by another route, such as a hosted control plane, can now ask the environment, before anything is written, what an install of a version would do with the fields that version declares `renamedFrom` on:

- `plan({ manifestId, incoming, installed })` takes the incoming and the installed version's bodies as published (`installed: null` for a fresh install) and answers `{ carries, refusals }`: each column the install would carry (`object`, `table`, `from`, `to`, the shape of the door's `renamesCarried`), and each declaration the door would refuse, with the door's reasons (`platform_column`, `live_key`, `claimed_twice`, `both_columns`, `several_old_columns`, `destructive_type`, `index_cannot_follow`, `transport`, `outside_package`) and its words.
- It is the install door's own planning step, not a copy: `POST /api/v1/marketplace/install-local` and the service call the same entry, so a non-empty `refusals` is exactly the door's `422 VALIDATION_ERROR` `details.refusals` for the same versions.
- It writes nothing: no column is renamed, no ledger entry or record is written, and nothing is held for an install. A table that cannot be read rejects the call, as the door answers `503`, never "nothing to carry".
- It is a service of its own, not a member of the install door's `marketplace-install-local` service, so a reader is never handed the install.
