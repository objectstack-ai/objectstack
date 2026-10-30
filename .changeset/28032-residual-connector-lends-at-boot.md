---
'@objectstack/objectql': patch
---

fix(objectql): a connector a composed stack declares only on its top level, beside package bodies that do not declare it, lends its credential at boot

Clause-②: no
Metadata-protocol: none

The engine's `manifest` service registers a multi-package stack's residual (top-level items no package body declares, ADR-0130 D4) objects under the stack's own `manifest.id`; it now registers the residual's connectors the same way. The connector credential lender and the ADR-0097 reconcile read the connectors from the ObjectQL registry only, so a residual connector instance used to be invisible to them at boot: the instance did not materialize, and a datasource whose `external.connector` names it had its borrow refused as undeclared until a dev reload, although `composeStacks(…, { manifest: 'preserve' })` accepts that borrow. Stacks whose top level repeats their bodies, and single-package stacks, are unchanged.
