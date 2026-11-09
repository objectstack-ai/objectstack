---
'@objectstack/cli': patch
---

fix(cli)!: `os serve` asks the multi-node gate about a topology declared by `OS_EXPECT_MULTI_NODE=true`, not only by `OS_CLUSTER_REPLICAS`

Clause-②: no (narrowing)
Metadata-protocol: none
Skills-docs: `skills/**` names neither spelling of the multi-node declaration. `content/docs/kernel/cluster.mdx` already teaches both spellings as the declaration; its sentence that a gate denial "downgrades … rather than failing" is corrected in this diff: with a declared topology the split-brain guard refuses the boot.

<!-- adr-0087: not-required (no-migration-prescription) No schema key, export, type or stored shape changes. The narrowing is a boot refusal keyed to environment variables an operator sets, so there is nothing for a metadata migration to rewrite and no tombstone. -->

**BREAKING** for a deployment that runs `os serve` with a remote cluster driver (`OS_CLUSTER_DRIVER` other than `memory`), declares multi-node only as `OS_EXPECT_MULTI_NODE=true`, and registers no multi-node gate.

A multi-node topology has two spellings, `OS_CLUSTER_REPLICAS` greater than 1 and `OS_EXPECT_MULTI_NODE=true`. With no gate registered, the gate refuses a declared multi-node topology, because multi-node is a licensed capability. `os serve` used to ask the gate with `OS_CLUSTER_REPLICAS` alone, so a topology declared only as `OS_EXPECT_MULTI_NODE=true` reached the gate as undeclared and booted the remote driver multi-node with no gate. The same deployment spelled `OS_CLUSTER_REPLICAS=2` was already refused.

After the upgrade both spellings answer the same way. `os serve` reads the declaration through `declaresMultiNode` from `@objectstack/service-cluster`. A declaration with no count is asked as 2 nodes, the smallest multi-node count. With no gate registered it prints `[cluster] multi-node not authorized (…)`, drops the remote driver, and the split-brain guard refuses the in-process fallback, so the boot stops.

FROM a multi-replica deployment that sets `OS_EXPECT_MULTI_NODE=true` over a remote driver with no gate TO either:

- register a multi-node gate (install the distribution that carries it), which authorizes the topology, or
- drop `OS_EXPECT_MULTI_NODE` (and keep `OS_CLUSTER_REPLICAS` unset or 1) to run single-node.

A single-node boot, a boot declared as `OS_CLUSTER_REPLICAS`, and a boot whose registered gate admits the topology are unchanged.

When a gate that caps the node count admits fewer nodes than that 2, the licensed-cap advisory no longer prints a replica count the operator did not write. It names `OS_EXPECT_MULTI_NODE=true`, says what the licence admits, says the cap is advisory and every replica still joins, and asks the operator to run at most that many replicas (or set `OS_CLUSTER_REPLICAS`) or raise the limit. The advisory for a count declared as `OS_CLUSTER_REPLICAS` is unchanged.
