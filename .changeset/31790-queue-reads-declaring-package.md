---
'@objectstack/objectql': patch
'@objectstack/plugin-approvals': patch
---

feat(objectql, plugin-approvals): a declared assignment rule and an approval step read the queue they name from the package that declares them

Clause-②: yes (widening); narrowing per ADR-0150 D3 declared below
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export or type of either package root changes: a queue name a package-declared assignment rule or approval step writes is now resolved from that package, through the ownership-queue service's existing optional callerPackageId. Nothing an author writes changes, so there is nothing for a migration to rewrite and no tombstone. -->

A declared assignment rule (`assignmentRules`) now passes the package that ships it as `callerPackageId` when it resolves its queue and reads the queue's members. An approval step passes the package that ships its flow (the automation engine's `packagedFlowOwner`) when it expands a `queue` approver, on the node's slate, its fallback slate and the tally of a request opened before the slate snapshot existed. The queue service resolves the name from that package (ADR-0150 D3): the package's own queue, else the one holder in its declared dependencies, else a refusal naming every candidate. An organization's own assignment rule, a declared rule no package ships and a flow authored in the deployment read environment-wide, exactly as before.

When a `queue` approver's name is refused this way, the approval node still refuses with `APPROVER_DIRECTORY_UNREADABLE`, but the message now says the name was refused (ADR-0150 D3), with the refusal and its remedy, instead of asking for the flow to run again once the directory can be read. Its `retryable` is `false`.

Widening, per ADR-0150 D3. A rule or step in package P that names queue `q` used to be refused because two packages declared the name, and is now served:

- P's dependency D and an unrelated package U both declare `q`: it reaches D's `q`;
- P declares `q` itself and an unrelated package U does too: it reaches P's own `q`.

Measured first-party: 0 (no first-party package declares a queue, an assignment rule or a `queue` approver).

Narrowing, per ADR-0150 D3. A rule or step in package P whose queue name P cannot reach used to be served environment-wide and is now refused:

- the only holder is a package outside P's dependencies (`outside-closure`, naming it);
- P's dependency D holds the name but is disabled, and an unrelated U holds it too (`outside-closure`, naming U; a disabled package holds no queue for this read);
- the only holder is an item authored in the environment (`outside-closure`, naming the environment).

An assignment rule then writes the row ownerless and in no queue, and warns; an approval node refuses to open, naming every candidate, as it does for a queue whose read failed. An organization's `sys_queue` row under a name no package declares is unchanged. To resolve it, declare a dependency on the package whose queue you mean, enable it, or ship the queue in P. Measured first-party: 0 (no first-party package declares a queue, an assignment rule or a `queue` approver).
