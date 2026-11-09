---
'@objectstack/spec': patch
'@objectstack/plugin-sharing': patch
---

feat(spec, plugin-sharing): the ownership-queue reads take an optional caller package, so a declared sharing rule's queue recipient resolves from the rule's package

Clause-②: yes (widening)
Metadata-protocol: none

`IOwnershipQueueService.resolveQueue`, `expandMembers` and `isMember` (`@objectstack/spec/contracts`) take an optional `callerPackageId` (new type `OwnershipQueueCallerPackage`, `string | null`). With it, a queue name resolves from that package (ADR-0150 D3): the package's own declared queue, else the unique holder in its declared dependency closure plus `sys`, else a refusal naming every candidate. Without it, the read is environment-wide, exactly as before. An implementation written before the key still satisfies the contract.

`@objectstack/plugin-sharing` implements it and passes it where a package wrote the queue name: a declared sharing rule's queue recipient is now read from the rule's package. A queue name the rule's package reaches through one declared dependency is served even when an unrelated package also declares a queue of that name; before, that name was refused because two packages declared it. Every other answer is unchanged: no caller package, one holder, two holders in the package's reach (refused, naming both), a holder only outside the reach (refused), and an organization's own `sys_queue` row.
