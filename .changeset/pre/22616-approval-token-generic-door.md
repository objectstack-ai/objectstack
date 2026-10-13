---
'@objectstack/plugin-approvals': minor
---

fix(plugin-approvals)!: `sys_approval_token`, the action-link tokens, is no longer exposed through the automatic API

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) No metadata an author writes moves: the narrowed declaration is the `enable` block of an engine-owned object this package ships and registers itself, objects are not overridable per organization, and no stored row is read, rewritten, converted or dropped, so there is nothing for `objectstack migrate meta` to rewrite. What narrows is a runtime door: the automatic API no longer serves this object's rows to any caller. Measured consumers of that door in this repository and in the pinned console: none outside one internal QA checklist procedure. The other categories are closed on facts: the bumped package publishes (not unpublished); no ADR-0087 id covers this path and this diff adds none (not registered / already-registered); and nothing exported changes (not runtime-interface-only / type-surface-only). -->

**BREAKING** (an accept-set narrowing on a runtime door), shipped as `minor` under the launch-window convention for breaking changes.

The object's own declaration already said its tokens are minted and consumed by the approval engine, never through the data API. It now says so in the form every door enforces, so the generic doors serve token rows to no caller, as the approvals door (`/api/v1/approvals/*`) serves them to nobody.

**What narrows, from → to.**

- The declaration: `enable.apiMethods: ['get', 'list']` becomes `enable.apiEnabled: false` with `enable.apiMethods: []`. `apiEnabled: false` is the automatic API's off switch, judged first for every operation; `apiMethods: []` is the declared fully-closed whitelist, so the whitelist no longer advertises the read methods either (an absent whitelist would read as fully open).
- The REST data routes (list, query, by id, export, and every write): a caller granted read on the object was served its rows, which name the request, the identity a link is bound to, the action, the expiry and the consumption state, and so was an administrator. Every caller, an administrator included, now receives `404 OBJECT_API_DISABLED`. The dispatcher and the MCP data tools judge the same switch first.
- Without a grant, the answer moves from `403 PERMISSION_DENIED` to `404 OBJECT_API_DISABLED`: the exposure gate is judged before the permission check.
- The cross-object search (`GET /api/v1/search`) no longer sweeps the object, for any caller.

**Unchanged.** The approval engine's own token path, which runs as the system: a reminder still mints one approve and one reject link per concrete pending approver, the link's confirm page still validates without consuming, one POST still decides as the bound approver, and a replay is still refused as already used. The digest is still stored, indexed and withheld from every generic exit (`internal: true`).

**What changes for you.** Nothing in the platform, the console or Setup reads this object through a generic door, so no shipped surface changes. A script or integration that read token rows through the data API now receives `404 OBJECT_API_DISABLED`. There is no replacement read, by design: a link's state is what its confirm page answers, and a decision taken through a link is recorded in the request's action history on the approvals door.
