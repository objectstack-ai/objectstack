---
'@objectstack/spec': patch
'@objectstack/plugin-sharing': patch
---

feat(spec, plugin-sharing): the ownership-queue reads take an optional caller package, so a declared sharing rule's queue recipient resolves from the rule's package

Clause-②: yes (widening); narrowing per ADR-0150 D3 declared below
Metadata-protocol: none

`IOwnershipQueueService.resolveQueue`, `expandMembers` and `isMember` (`@objectstack/spec/contracts`) take an optional `callerPackageId` (new type `OwnershipQueueCallerPackage`, `string | null`). With it, a queue name resolves from that package (ADR-0150 D3): the package's own declared queue, else the unique holder in its declared dependency closure plus `sys`, else a refusal naming every candidate. Without it, the read is environment-wide, exactly as before. An implementation written before the key still satisfies the contract.

`@objectstack/plugin-sharing` implements it and passes it where a package wrote the queue name: a declared sharing rule's queue recipient is now read from the rule's package. A queue name the rule's package reaches through one declared dependency is served even when an unrelated package also declares a queue of that name; before, that name was refused because two packages declared it. Every other answer is unchanged: no caller package, one holder, two holders in the package's reach (refused, naming both), a holder only outside the reach (refused), and an organization's own `sys_queue` row.

Narrowing, per ADR-0150 D3: take a declared rule whose package depends on a package D that is disabled, where an unrelated package U declares a queue of the same name. That rule used to grant to U's queue members. Its queue recipient is now refused. The refusal is logged once at `warn` and names U as outside the rule package's dependency closure. U's members gain no grant from it; grants the rule already holds are kept, as for any refused recipient. A disabled package holds no queue for this read, the same population the listing serves. To resolve it, enable D or declare a dependency on the package whose queue you mean. Measured first-party: 0 (no first-party package declares a queue).
