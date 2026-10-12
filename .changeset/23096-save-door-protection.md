---
'@objectstack/metadata-protocol': minor
'@objectstack/spec': patch
---

fix(metadata-protocol)!: the metadata save door refuses a `protection` block with a located `400 VALIDATION_ERROR` instead of storing a lock that binds nothing (ADR-0010 §3.5, Phase 4.3)

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves: `protection` stays declared on every type that declares it, a code package's source keeps it, and the package loader still translates it into the item's lock; no spec key, authorable spelling, export or stored shape is added, removed, renamed or re-shaped, and a row stored before this change keeps its bytes and loads unchanged, so there is nothing for `objectstack migrate meta` to rewrite. What narrows is one runtime write door: a body saved through the metadata API that carries the block is refused, and the remedy is in the request a caller sends to that door, never a rewrite of a package source or a stored row. The other categories are closed on facts: both packages publish (not unpublished); no ADR-0087 id is named or touched (not registered or already-registered); and no exported declaration is removed or narrowed (not runtime-interface-only, type-surface-only or runtime-export-retired). -->

**BREAKING** (an accept-set narrowing), shipped as `minor` under the launch-window convention for breaking changes.

`protection` is the package author's lock declaration. ADR-0010 states one door for it: a code package's loader translates it into the item's private lock envelope when the package loads, and strips it (Phase 4.3). An item saved through the metadata API is authored in the environment, and ADR-0010 §3.5 states that such an item takes no package lock.

**FROM.** `PUT /api/v1/meta/{type}/{name}` with a `protection` block answered `200` and stored the block verbatim. The item was then served with `protection.lock: 'full'` while it read `lock: 'none'`, `editable: true` and `deletable: true`, and a second save and a delete both answered `200`. Measured on the showcase for an `app` and a `dashboard`. An author, or an AI, reading that item was told it was protected when anyone holding the authoring capability could change or delete it.

**TO.** The same save answers `400 VALIDATION_ERROR` and writes nothing. The message names the block and the door that does honour it, and the envelope's `issues[]` carries `protection` as the path, so the Studio designer can highlight it.

- **Every type that declares the block**, in draft and in publish mode, for a new item and for an overlay of a packaged one. A malformed block is refused the same way, because the block is not accepted at this door at all. On a type whose schema does not declare `protection`, the schema's own `422 INVALID_METADATA` answers, as before.
- **Every authoring write**: the REST and dispatcher saves and the domain doors that save through them. The unmanaged install already drops a block it can read before it saves a copy, and a malformed one is refused here.
- **Server-side rewrites strip it.** A row stored before this change may carry the block. When the server itself rewrites such a row (`os migrate meta --stored --apply`, the stored flow credential move, package duplication), it drops the block instead of failing the rewrite: the block never bound, so nothing changes but the stored bytes.
- **Unchanged.** A body without `protection` saves as before. A packaged item's lock still binds: its loader translated the block at load time, and a save against it still answers `403 ITEM_LOCKED`, or `403 NOT_OVERRIDABLE` on a type with no environment overlay, before this refusal is asked. A row stored before this change keeps its bytes.
- **Package export.** `GET /packages/:id/export` copies a writable base's rows into a manifest, so a block saved into a base row rode into that manifest, where the package loader translates it on install. A block can no longer be saved into a base row. Declare it in the manifest you install instead.
- **Remedy.** Delete the `protection` block from the body you send to the metadata API. To lock an item, declare `protection` on it in a code package's source.

`@objectstack/spec`: the `protection` TSDoc on every type that mounts it (app, view, dashboard, report, dataset, object, flow, webhook, agent, tool, skill, position, permission set, email template) now says that only the package loader translates the block, and that the metadata API's save door refuses it.
