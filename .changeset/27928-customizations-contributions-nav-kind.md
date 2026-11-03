---
'@objectstack/spec': minor
---

feat(spec): the customizations read's `contributions` declares a `nav` kind, with an entry shape per kind

Clause-②: yes (widening)
Metadata-protocol: added

`GET /packages/:id/customizations` names the package behind each item another installed package contributes to a base (ADR-0029 D7 as amended by ADR-0146 D3). `GetPackageCustomizationsResponseSchema.contributions` now declares a third kind: the navigation items another package's `navigationContributions` add to an app the base owns.

- **The entry shape is per kind.** A `field` or `flow` entry is `{ kind, object, name, packageId }` and accepts exactly what it accepted before. A `nav` entry is `{ kind: 'nav', app, group?, name, packageId }`: the base-owned app, the group the contribution targets when it targets one, the nav item's id, and the contributing package. Each shape is strict, so a `nav` entry carrying `object`, or a `field` entry carrying `app`, is refused.
- **Order.** The `field` and `flow` entries come first, in the order they had before. The `nav` entries follow, by app, group (an entry with no group first), name and package. `counts.contributions` still counts items.
- **Not served yet.** The runtime lists no `nav` entry yet. The kind is declared ahead of its producer, and its describe opens `[PLANNED — not yet served]`. No nav item gains a key: the served app's `navigation` stays as declared.

TypeScript code that reads `object` from a `contributions` entry now narrows on `kind` first (`entry.kind !== 'nav'`), because a `nav` entry has no `object`.
