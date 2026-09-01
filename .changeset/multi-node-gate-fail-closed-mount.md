---
"@objectstack/service-cluster": minor
"@objectstack/cli": patch
---

fix(service-cluster,cli): the multi-node gate fails closed when unregistered, and is mounted on every boot route (#13537)

**BREAKING behaviour narrowing on a licensed capability, shipped as `minor`
under the repo's launch-window convention for breaking changes.**

Multi-node clustering is a paid capability (maintainer ruling 2026-08-31,
recorded on #13537). Two defects together made its authorization gate
unenforceable by construction — measured on a real thin-extension EE
deployment, a `maxNodes: 1` trial license booted 3 replicas with full cluster
coordination and no warning (cloud#1752):

- `checkMultiNodeAllowed` **defaulted to ALLOW when no gate was registered**,
  so every boot route that skipped the one config file wiring the gate ran an
  unlicensed cluster silently.
- `registerMultiNodeGate` was reachable from exactly **one** mount point (the
  EE app config, cloud repo), which the thin-extension and `OS_ARTIFACT_URL`
  artifact-direct boot routes never execute.

Both halves change:

- **Fail-closed default** (`@objectstack/service-cluster`): with no gate
  registered, a DECLARED multi-node topology (`requested > 1`) is now
  **refused** — `os serve` drops the remote driver and warns loudly.
  ⛔ Read the boot outcome precisely: with a multi-node topology declared, the
  in-process fallback then trips the split-brain guard and the boot is
  **REFUSED**, not quietly degraded (measured on #14116; the guard's trigger
  and this default's trigger are the same declaration). The refusal is the
  correct outcome — N replicas on per-process locks is the silent split-brain
  that guard exists to stop — but it is a refusal, and an operator upgrading
  into this default must be told so. An undeclared or single-replica count (`OS_CLUSTER_REPLICAS`
  unset, `1`, or meaningless) keeps the historical allow: it declares no
  multi-node topology, so there is nothing to gate. A registered gate's
  verdicts are byte-identical to before — entitled deployments are untouched.
  New exports: `hasMultiNodeGate()`, `MULTI_NODE_NO_GATE_REASON`.
- **Route-independent mounting** (`mountMultiNodeGateFromHost`, new): the boot
  surface about to consult the gate hands over its host-anchored importer and
  the helper loads the distribution packages that carry the gate
  (`MULTI_NODE_GATE_CARRIER_PACKAGES`), so registration no longer depends on
  one app config file executing. `os serve` now calls it before the consult
  (`@objectstack/cli`), best-effort: with no distribution installed nothing
  mounts and the fail-closed default answers.

**Migration.** A deployment that ran `OS_CLUSTER_DRIVER` (non-memory) with
`OS_CLUSTER_REPLICAS > 1` and **no** registered gate was running an
unlicensed multi-node topology on the old fail-open default; it now downgrades
to single-node at boot and logs the refusal. Deploy a distribution that
registers the gate (at module load of a carrier package, so every boot route
mounts it), or remove the multi-node declaration.

<!-- adr-0087: not-required (no-migration-prescription) A runtime default-direction change on the multi-node authorization gate: no spec key is removed, renamed or re-shaped, so there is no tombstone and nothing mechanical for `objectstack migrate meta` to rewrite. The channel that reaches an affected operator is the boot-time refusal itself (`os serve` logs `MULTI_NODE_NO_GATE_REASON` with the remedy, and a declared multi-node topology then stops the boot at the split-brain guard rather than degrading silently); whether to deploy a gate-registering distribution or drop the multi-node declaration is a deployment decision no migration entry can perform. -->
