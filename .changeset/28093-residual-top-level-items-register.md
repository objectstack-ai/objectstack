---
'@objectstack/objectql': patch
---

fix(objectql): every item a composed stack declares only on its top level, beside package bodies that do not declare it, registers in the engine at boot the way a package body's item of that type does

Clause-②: yes (widening)
Metadata-protocol: none

The engine's `manifest` service registered a multi-package stack's residual (top-level items no package body declares, ADR-0130 D4) objects, connectors and flows under the stack's own `manifest.id`, and no other type. A residual permission set, position, capability, sharing rule, queue, assignment rule, app, view, page, dashboard, report, action, hook, agent, tool, skill, API endpoint, webhook, email template, doc and every other collection a package body registers was held by the metadata service alone, so a reader that asks the engine registry answered as if it were not declared. Among those readers is the metadata save door's managed-content check: a residual top-level security rule was not sealed against an environment save the way the same rule declared in a package body is; it now is.

Each such item now registers under the stack's manifest id and version, through the judges a body's item of that type passes: a view container is filed under its object and expanded into its views after the divergent-`name` judge, a permission set whose `packageId` names another package is refused (ADR-0086 D3), an action is parsed against its schema, and the boot's later checks (the ownership-queue service check for queues and assignment rules, the bound-action target audit) now cover residual items too, so a residual queue on a composition without an ownership-queue service fails the boot with the prescription a body's does. Picklists stay metadata-only, as the residual objects rule already states. A top-level item a package body declares is still registered once, as that body's; stacks with no residual item, and single-package stacks, are unchanged.
