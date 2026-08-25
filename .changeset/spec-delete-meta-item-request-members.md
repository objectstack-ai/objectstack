---
"@objectstack/spec": minor
---

**`DeleteMetaItemRequestSchema` declares the contract members the REST reset door sends** (#11679 — the #11006 maintainer-ruled pattern on the request-shape half).

`MetadataProtocol.deleteMetaItem` was declared all along, but its request schema declared 2 of the 8 members `DELETE /api/v1/meta/:type/:name` sends — so the door's call site had to stay behind an `(p as any)` cast (removing it surfaced `TS2353` on six keys, the opposite half of the publish door's `TS2339`), and the one member most worth having a contract — `organizationId`, which selects WHICH overlay row a reset destroys (ADR-0005 org partition; an org-less delete reaches the environment-wide row) — was on the wire with no declaration behind it.

Additive, not breaking — the five contract-level members join the schema, mirroring the implementation's parameter type in `@objectstack/metadata-protocol`:

- `organizationId?` — tenant scope for the reset (#8805); load-bearing, decides which row the delete destroys.
- `parentVersion?` — the ADR-0008 optimistic-concurrency pin (REST: the `If-Match` header); absent = last-write-wins.
- `actor?` — identity recorded on the history tombstone row (one producer, #7749); absent = recorded actor-less, never "system" (#4556).
- `state?` — `'active' | 'draft'`; `draft` discards the pending draft overlay only.
- `dropStorage?` — destructive opt-in (default false): also drop the object's physical table (`object` + `active` only; never `sys_`).

Two wire members stay out, by ruling rather than omission: `environmentId` (transport-level routing key per #9741, layered on by `packages/rest`'s `TransportScopedMetaRequest`) — and there are no internal coordination keys on this door (`_skipSeedApply` is publish-batch-only).
