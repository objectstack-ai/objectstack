---
'@objectstack/spec': patch
'@objectstack/platform-objects': patch
---

Clause-②: no

fix(spec): published copy that names the running system says "this system", or drops the noun, not "this environment"

- **What changed.** Inside the running system, user-facing copy names the system the reader is in as "this system", or drops the noun. A permission set made here, not shipped by a package, is "authored in this system".
  - The permission-set `packageId` refusal on the save, restore and publish doors now reads "a set written into no package is authored in this system, which an absent `packageId` states".
  - The permission set's `packageId` help text in Setup ends "Leave empty for a set authored in this system." The English Setup forms bundle of `@objectstack/platform-objects` is regenerated from it.
  - The `permission.managedBy` tombstone prescription, and the `permission-set-managed-by-retired` protocol-18 upgrade-guide entry, say "a set authored in this system carries neither".
  - The `AudienceConfig.posture` and `AuthConfig.audience` describes say "who may self-register", with no noun. Their TSDoc says "who may become a user of this system's apps", the sentence the Setup Authentication group already reads.
  - `AiModelsResponse.models` describes "Models this system offers". The `IMetadataService.listDiagnosed` TSDoc example reads "this system contains N items".
- **Kept "environment", where the word names a deployment or configuration scope.** `SeedLoaderConfig.env` ("Only load datasets matching this environment", the `prod | dev | test` tier), the `package-uninstall-environment-wide` upgrade-guide entry (the ADR-0131 environment-wide scope, as against an organization), and the environment artifact's consent-record TSDoc.
- **Unchanged.** Every error code, status, issue path, accepted value and export. Only the human-readable text moves.
