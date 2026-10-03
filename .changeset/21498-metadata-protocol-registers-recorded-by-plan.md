---
"@objectstack/metadata-protocol": patch
---

The metadata protocol registers its journal-backed migration plan, `metadata.recorded-by-sentinel-to-null`, with the kernel's `migration-plans` registry (#21498)

Clause-②: no

A migration journal records a run's plan hash, not the plan's code. To resume a run, the package that owns the plan has to register it. This package owns the `recorded_by` sentinel-to-NULL plan, and until now it never registered it. So any process that composed the registry still reported the run as unresumable.

The protocol assembly (`assembleMetadataProtocol`, which `ObjectQLPlugin` and `MetadataProtocolPlugin` both run) now registers the plan at `kernel:ready`. It does so only when a `migration-plans` service is composed. That runs before `MigrationRecoveryPlugin`'s boot scan, so the scan reports the run as resumable. A kernel with no registry is unchanged. Registering a plan runs nothing: only `os migrate resume` acts on it.
