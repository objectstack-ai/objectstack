---
'@objectstack/plugin-approvals': minor
'@objectstack/plugin-audit': minor
---

fix(plugin-approvals,plugin-audit)!: a lookup target's title is read only when the TARGET object's declared exposure serves `get` — the approvals inbox's `payload_display` and the activity summary (#22738)

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves: no spec key, authorable spelling, export or stored shape is removed, renamed or re-shaped, so there is nothing for `objectstack migrate meta` to rewrite. What narrows is two served titles: each stops naming a lookup's target object whose existing `enable` declaration already refuses `get` on every data route, and the remedy is the declaration the author already wrote. The other categories are closed on facts: both packages publish (not unpublished); no ADR-0087 id is named or touched (not registered or already-registered); and no exported declaration is removed or narrowed (not runtime-interface-only or type-surface-only). -->

**BREAKING** (an accept-set narrowing), shipped as `minor` under the launch-window convention for breaking changes.

The data routes judge an object's `enable` block through the spec's one exposure decision (`apiExposureDenialReason` / `canServeApiOperation`), and the data door's `$expand` and the dataset door's labels already ask it of a lookup's TARGET. Two more reads follow a lookup to its target's title under a system context and never asked it.

**FROM.** For an administrator and a member alike:

- **Approvals inbox** (`@objectstack/plugin-approvals`): `GET /api/v1/approvals/requests` and `GET /api/v1/approvals/requests/:id` carried, in `payload_display`, the title of a snapshot lookup's target whose declaration refuses `get`.
- **Activity summary** (`@objectstack/plugin-audit`): an update's tracked-change summary, and a fired milestone's summary, named such a target's records by title in the `sys_activity` row served by `GET /api/v1/data/sys_activity`.

**TO.** Each title read first asks the decision of the TARGET object, for `get` (turning an id into the record it names, the read `GET /api/v1/data/:target/:id` performs):

- A refused target is not read. The inbox carries no `payload_display` entry for that key, so the snapshot's stored id stands, which is what a deleted target already answers. The activity summary names the record by its stored id, which is what an unresolvable reference already answers.
- A declaration that cannot be read withholds the title too (fail-closed, at `warn`).
- Only activity rows written from now on change. A written row is a snapshot and is never rewritten, and no other activity column changes.

A target declaring `apiEnabled: false`, the deny-all `apiMethods: []`, or a whitelist without `get` (for example `['list']`) is withheld; a target with no `enable` block, or a whitelist that grants `get`, is served exactly as before. The decision takes no caller.

**Measured producers.** Read on `origin/main` `bf515e724d` over every non-test `.ts` source under `packages/` and `examples/`: ten objects refuse `get` by declaration, and exactly one lookup points into any of them, from an object that is itself `apiEnabled: false` (control: 88 lookups into `sys_user`). So no shipped object's served title changes. Deployed and cloud-held object definitions were NOT MEASURED.
