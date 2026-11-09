---
'@objectstack/cloud-connection': patch
---

feat(cloud-connection): mount the declared-rename planner without the install door

Clause-②: yes (widening) — one new root export of `@objectstack/cloud-connection`, `MarketplaceInstallRenamePlannerPlugin`. The planner signature, its result types and the service name are unchanged, and nothing is narrowed.
Metadata-protocol: none

The read-only declared-rename planner (`INSTALL_RENAME_PLANNER_SERVICE`, `marketplace-install-rename-planner`) was registered only by `MarketplaceInstallLocalPlugin`, so a kernel that serves no install-local door, such as a hosted environment's, could not reach it. `MarketplaceInstallRenamePlannerPlugin` registers that one service and nothing else: no route, no install ledger, no rehydrate. The planner reads the kernel's data engine (`objectql`) and its driver when it is asked.

```ts
import { MarketplaceInstallRenamePlannerPlugin, INSTALL_RENAME_PLANNER_SERVICE, type InstallRenamePlanner } from '@objectstack/cloud-connection';

await kernel.use(new ObjectQLPlugin());
await kernel.use(new MarketplaceInstallRenamePlannerPlugin());
// in a plugin's start(): ctx.getService<InstallRenamePlanner>(INSTALL_RENAME_PLANNER_SERVICE).plan({ manifestId, incoming, installed })
```

- One implementation: the plugin and the install door both register the planner from one shared module, and the door's own install step plans through the same entry.
- A host that mounts only the install door keeps the service as before.
- Mounting both is safe in either order: whichever initializes first registers the service and the other leaves it, so the kernel never sees a second registration.
