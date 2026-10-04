---
'@objectstack/runtime': minor
'@objectstack/cloud-connection': minor
---

fix(runtime,cloud-connection)!: install-local refuses an enabled job whose `pull` does not bind, as it refuses a job `body` that does not bind (#21672)

Clause-②: yes (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) no authorable key, spelling, export of a published release or stored shape moves: `JobSchema` and `MappingSchema` are unchanged, so `objectstack migrate meta` has nothing to rewrite. What changes is which packages one install door accepts. The other categories are closed on facts: the packages publish (not `unpublished`); no ADR-0087 id covers a refused install (not `registered` / `already-registered`); and the change is runtime behaviour, not a declaration (not `runtime-interface-only` / `type-surface-only`). -->

**BREAKING**: `os package install` (the install-local door, `POST /api/v1/marketplace/install-local`) now refuses a package whose enabled job declares a `pull` that does not bind. It used to install such a package with a 200, and the job was never scheduled; only a server warn said so.

- **What does not bind.** The `pull` names a mapping the package does not declare, or a mapping with no `connectorSource`, or the job declares `body` or `handler` beside its `pull`. The door judges this with the scheduler's own judgement, so the door and the scheduler cannot disagree. `defineStack` and `os validate` already refuse the same `pull`, so only a hand-edited package reaches the door with one.
- **The refusal.** The install answers `422` with `VALIDATION_ERROR`, the answer the door already gives an enabled job whose `body` does not bind. One answer names everything the door cannot run, and gives each such job the reason its `pull` does not bind, prefixed with the key it names (`pull.mapping: …`). Nothing is installed: nothing is registered, persisted or scheduled. `os package install` exits non-zero and prints the code beside the status.
- **Unchanged.** A pull job naming a declared mapping with a `connectorSource` installs and is scheduled as before. A disabled pull job does not block its install. A package installed by an earlier version still rehydrates after a restart, and its pull job that does not bind is not scheduled, with a warn naming the job and the reason, as before.
- **Runtime.** `collectJobsWithoutBody` now names an enabled job whose `pull` does not bind, and `JobWithoutBody` gains an optional `pullRefusal`: the reason the scheduler gives when it does not schedule the job. Such a job carries no `bodyRefusal`.

The route for a refused package: declare the mapping the job's `pull` names in the package, with a `connectorSource` naming the `rest` or `openapi` connector it reads from, or correct the `pull` as the refusal says. `os validate` refuses the same `pull`. This ships as `minor`, under the launch-window convention for narrowings of an accept set.
