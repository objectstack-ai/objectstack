---
'@objectstack/cli': patch
---

fix(cli)!: `os serve` asks the multi-node gate about a topology declared by `OS_EXPECT_MULTI_NODE=true`, not only by `OS_CLUSTER_REPLICAS`

Clause-②: no (narrowing)
Metadata-protocol: none
Skills-docs: none — `skills/**` names neither spelling of the multi-node declaration. `content/docs/kernel/cluster.mdx` already teaches both spellings as the declaration and that `os serve` passes the declared `OS_CLUSTER_REPLICAS` count to the gate, which stays true; that page's older "downgrades … rather than failing" sentence is noted on the PR, outside this diff.

<!-- adr-0087: not-required (no-migration-prescription) No schema key, export, type or stored shape changes. The narrowing is a boot refusal keyed to environment variables an operator sets, so there is nothing for a metadata migration to rewrite and no tombstone. -->

**BREAKING** for a deployment that runs `os serve` with a remote cluster driver (`OS_CLUSTER_DRIVER` other than `memory`), declares multi-node only as `OS_EXPECT_MULTI_NODE=true`, and registers no multi-node gate.

A multi-node topology has two spellings, `OS_CLUSTER_REPLICAS` greater than 1 and `OS_EXPECT_MULTI_NODE=true`. With no gate registered, the gate refuses a declared multi-node topology, because multi-node is a licensed capability. `os serve` used to ask the gate with `OS_CLUSTER_REPLICAS` alone, so a topology declared only as `OS_EXPECT_MULTI_NODE=true` reached the gate as undeclared and booted the remote driver multi-node with no gate. The same deployment spelled `OS_CLUSTER_REPLICAS=2` was already refused.

After the upgrade both spellings answer the same way. `os serve` reads the declaration through `declaresMultiNode` from `@objectstack/service-cluster`. A declaration with no count is asked as 2 nodes, the smallest multi-node count. With no gate registered it prints `[cluster] multi-node not authorized (…)`, drops the remote driver, and the split-brain guard refuses the in-process fallback, so the boot stops.

FROM a multi-replica deployment that sets `OS_EXPECT_MULTI_NODE=true` over a remote driver with no gate TO either:

- register a multi-node gate (install the distribution that carries it), which authorizes the topology, or
- drop `OS_EXPECT_MULTI_NODE` (and keep `OS_CLUSTER_REPLICAS` unset or 1) to run single-node.

A single-node boot, a boot declared as `OS_CLUSTER_REPLICAS`, and a boot whose registered gate admits the topology are unchanged.
