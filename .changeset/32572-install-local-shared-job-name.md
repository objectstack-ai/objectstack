---
'@objectstack/cloud-connection': patch
'@objectstack/runtime': patch
---

fix(cloud-connection, runtime)!: install-local refuses a package with two enabled jobs of one name, as the binder refuses the name at bind

Clause-②: yes (narrowing) — the install-local install route (`POST /api/v1/marketplace/install-local`) refuses a package with two or more enabled jobs of one name with `422 VALIDATION_ERROR`, where it answered `200` and the binder then scheduled none of those jobs. The widening half: `@objectstack/runtime` exports `collectJobNameCollisions(bundle, appId)`, the binder's own judgement of a shared job name, which the door refuses by.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and nothing at rest moves: what moves is the install door's answer to a package whose enabled jobs share a name, which the binder already refused to schedule. A package installed before keeps rehydrating; its shared name is refused at bind as before, so there is nothing for a migration to rewrite. -->

**BREAKING** accept-set narrowing at the install-local door (`@objectstack/cloud-connection`): a package whose enabled jobs share a name is refused instead of installed.

- **Before.** `os package install` (and any client of `POST /api/v1/marketplace/install-local`) answered `200` for a package declaring two enabled jobs of one name. The binder then refused the name at `error` (the job service keys a job by its name and would keep only the later one): none of those jobs was scheduled, and the job of that name the previously installed version ran was cancelled. The door said the install succeeded.
- **Now.** The install is refused with `422 VALIDATION_ERROR`, the refusal this door gives every job it cannot run, before anything is registered, persisted or scheduled, so the installed version and its jobs keep running. The message quotes the binder's own refusal of the name: every job of it by how it runs, and every holder that declares it — each package body, and the artifact's top level outside every package body (its residual) when that carries the name too. A disabled twin collides with nothing and installs as before, and so do jobs of distinct names.
- **Who moves.** An author whose package declares one job name twice among its enabled jobs. A package installed before this release still loads after a restart; its shared name is refused at bind and logged, as before.

**The remedy.** Rename all but one of the jobs so each job name is declared once in the artifact, or set `enabled: false` on the ones that should not run, then install again.

`collectJobNameCollisions(bundle, appId)` (`@objectstack/runtime`): the job names two or more enabled jobs of `bundle` share, each with the `PackageScopedRefusal` the binder (`scheduleAppArtifactJobs`) refuses it by when it schedules the artifact as `appId`. A door that pre-judges a package reads it so it cannot disagree with the binder.
