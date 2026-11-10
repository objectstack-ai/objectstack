---
'@objectstack/runtime': patch
'@objectstack/service-cluster': patch
'@objectstack/cloud-connection': patch
---

fix(runtime): the multi-replica package refusal names a recipe that works, instead of "run it on a single replica or through the CLI", which are both refused or unavailable

Clause-②: no
Metadata-protocol: none

Under declared replicas (`OS_CLUSTER_REPLICAS` greater than 1, or `OS_EXPECT_MULTI_NODE=true`) on the Redis cluster driver, the runtime package doors still refuse `409 MULTI_REPLICA_PACKAGE_CHANGE_REFUSED` before anything is written: install (`POST /api/v1/packages`), enable, disable, duplicate, ensure-customization, manifest edit, delete, and a flow or permission-set clone that would create its customization package. Only the message changes. It used to say "run it on a single replica or through the CLI, then restart every replica". But every replica refuses the change the same way while the declaration stands, and no `os` command sends these requests.

The message now says that every replica refuses the change while the declaration stands, whichever client sends it, and gives the steps that work:

1. Scale the deployment to one replica and restart it with `OS_CLUSTER_REPLICAS=1` and `OS_EXPECT_MULTI_NODE` unset.
2. Repeat the request against that replica.
3. Restore the replica count and the declaration, and restart every replica.

It also states the condition those steps depend on. When a replica starts, it loads the packages changed at runtime from the database (`sys_packages`), and the enable/disable choice from its package-state store. So the change reaches every replica only when they all read the same database and the same package-state store: the host's store, or `package-state` under one shared `OS_HOME` with every replica started from the same directory.

The three steps are the same recipe the marketplace install-local refusal names. `@objectstack/service-cluster` now exports it once as `multiReplicaMaintenanceWindowRecipe(act)`, beside `declaresMultiNode`, the function that reads the two settings it lifts. Both refusals build their message from it. The install-local message is byte-for-byte unchanged.
