---
'@objectstack/spec': patch
---

feat(spec): a connector pull request can carry the caller's package, so the pull can read its mapping by (package, name)

Clause-②: yes (widening)
Metadata-protocol: none

`ConnectorSourcePullRequest` (`@objectstack/spec/contracts`, the request of `IAutomationService.pullConnectorSource`) gains an optional `callerPackageId` (`string | null`), spelled and typed as the ownership-queue reads' caller package. For a job's pull it is the job's package. With it, the `mapping` name resolves from that package (ADR-0150 D3): the package's own mapping, else the unique holder in its declared dependency closure plus `sys`, else a refusal naming every candidate. Without it (omitted, `null` or `''`), the read is by no package, exactly as today. An implementation written before the key still satisfies the contract and reads by no package; no implementation reads it yet, and nothing a metadata author writes changes.
