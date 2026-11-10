---
'@objectstack/cloud-connection': patch
---

fix(cloud-connection): the multi-replica install-local refusal names a recipe that works, instead of "run the install script", which posts to the same refused door

Clause-②: no
Metadata-protocol: none

Under declared replicas (`OS_CLUSTER_REPLICAS` greater than 1, or `OS_EXPECT_MULTI_NODE=true`) on the Redis cluster driver, `POST` and `DELETE /api/v1/marketplace/install-local` still refuse `409 MULTI_REPLICA_PACKAGE_CHANGE_REFUSED` before anything is written. Only the message changes. It used to tell the operator to "run the install script, then restart every replica", but that script runs `os package install`, which posts to this same door and is refused the same way.

The message now says that every client of the door is refused while the declaration stands, and gives the steps that work:

1. Scale the deployment to one replica and restart it with `OS_CLUSTER_REPLICAS=1` and `OS_EXPECT_MULTI_NODE` unset.
2. Run the install or uninstall against that replica.
3. Restore the replica count and the declaration, and restart every replica.

It also states the condition those steps depend on. Each replica loads the packages its install ledger lists when it starts (`installed-packages` under `OS_HOME`, unless the host configures another directory). So the change reaches every replica only when they all read that one directory.

`os package install` prints the door's message verbatim, as before. The text is now exported once as `multiReplicaInstallLocalRefusalMessage(subject)`, so the command and the door are pinned against the same sentence.
