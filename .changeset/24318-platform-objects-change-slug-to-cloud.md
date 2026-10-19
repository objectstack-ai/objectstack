---
'@objectstack/platform-objects': minor
---

fix(platform-objects)!: `sys_organization` no longer declares `change_slug`, whose door only the cloud orchestrator mounts (#24318)

Clause-②: no (narrowing) (a platform object stops declaring an action whose door exists only in cloud; owes a `CONTRACT_REVIEW_TIER` review on the narrowing face before the queue, and the `repo:cloud#2` seat's pointer before landing)

`sys_organization` declared a `change_slug` action ("Change Slug") at `record_header`, gated on `multiOrgEnabled`, whose target, `/api/v1/cloud/organizations/{id}/change-slug`, no package in this repository serves. So on every open-source composition with multi-organization on, the organization record page offered Change Slug in its `⋯` overflow, and the click answered `404 ENDPOINT_NOT_FOUND`. Measured on a booted multi-organization showcase.

The action now belongs to the composition that serves its route. That composition declares `change_slug` as a top-level action bound by `objectName: 'sys_organization'`, and the registry attaches such an action to the served object, whichever package registers first.

**BREAKING — what moves for consumers.** A declared action leaves a published platform object, shipped as `minor` under the launch-window convention for breaking changes (pre mode was exited at `c46b5f14cf`, so the launch-window guard is armed and a breaking change ships as `minor`).

- FROM: `GET /api/v1/meta/object/sys_organization` served `change_slug` on every composition, and the four generated locale bundles carried its `label`, `description` and `successMessage`.
- TO: the object serves it only where a composition binds it. The open-source record header offers Invite User, Set Active and Rename Organization inline, and Leave Organization in the overflow; each of them is a better-auth door this composition mounts.
- Fix: cloud declares its own `change_slug`, the same declaration bound by `objectName: 'sys_organization'`, with its own translations. An open-source composition changes an organization's slug through `update_organization` (better-auth's `organization/update`, list row), as before.

**Unchanged.** `rename_organization` (name and logo, no slug) and `update_organization` (name, slug and logo, list row only) keep their declarations, gates and order. No stored row moves.

<!-- adr-0087: not-required (no-migration-prescription) a platform object stops declaring one action whose door exists only in another composition: no authorable spec key, spelling, export or stored shape moves, and no stored row is read, rewritten or converted. The repair is the serving composition's own declaration of the action, which no ledger entry can derive. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id covers this declaration (not already-registered); and the change is an object's declared action, not a runtime interface, a type surface or an export (not runtime-interface-only, type-surface-only or runtime-export-retired). -->
