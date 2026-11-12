---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol)!: when two packages ship one name and each has its declared `.custom` override, the lists and the boot pull use each override in its own package's slot, in any registration order (ADR-0150 D4)

Clause-②: no (narrowing) — the env-wide lists stop serving the extra entries they served before: for a name two or more packages ship, each with a declared `.custom` override, the entry under the override's pair slot (stamped with the name's first shipper) is no longer listed. First-party callers that read those entries: 0.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) no key of any schema is added, removed, renamed or re-shaped and no stored row changes shape: what moves is which entries the env-wide lists serve for a name two packages ship and which stored row the boot pull arms first, so there is nothing for `objectstack migrate meta` to rewrite -->

**BREAKING** for a caller that read the env-wide flow or action list (`GET /meta/flow`, `GET /meta/action`, `getMetaItemsForExecution`) and used an entry stamped with one package that carried another package's declared override. Such an entry is no longer listed. Read each package's override from its own entry, or by its package (`?package=ID`). Nothing in the workspace reads those entries.

Two packages ship a flow or an action of the same name. Each has a declared override in its own `.custom` pair. Before this fix, two places got this wrong.

- **The lists.** These are the served list (`GET /meta/flow`, `GET /meta/action`, naming no package) and the execution view (`getMetaItemsForExecution`, which the automation engine arms from). They listed each override a second time, under its pair's slot. The name's first registered shipper stamped its own package on that extra entry. Alpha first gave `alpha:OVR-A` twice, `alpha:OVR-B` and `beta:OVR-B`. Beta first gave `alpha:OVR-A`, `beta:OVR-A` and `beta:OVR-B` twice. So one package's override was listed under the other package. Now each override is listed once, as its own package's item: exactly `alpha:OVR-A` and `beta:OVR-B`, in either order. When only one package ships the name, the pair's slot was already dropped, so that case is unchanged.
- **The boot pull.** The hydration decides which stored row holds a flow name's bare registry slot. It judged a row as a declared override against the first holder only. So the second holder's override counted as a plain stored row. If a package-less row was read after it, that row took the slot and the override was lost. The automation boot pull then armed that holder's shipped flow until `kernel:ready` re-armed from the protocol's view. A record change in that window ran the wrong body. Now a row is judged against every package that ships the name, and each override is armed in its own package's slot from the first pull.

No door refuses a request it answered before, and no key, value or stored shape changes. The by-name reads (`?package=`) already answered each package's own override and are unchanged.
