---
"@objectstack/spec": minor
---

`ERROR_CODE_LEDGER['@objectstack/lint']` now lists `INVALID_ARTIFACT_PACKAGES`, the code `packages/lint`'s `packagesOf` reader stamps for a malformed `stack.packages` (#20206) — required by `check:error-code-provenance`, which refuses a registered code stamped by a package whose own owner key does not list it.

Clause-②: yes

Provenance, not identity: the code was already registered under `@objectstack/core` (`resolveArtifactPackageOrder`, the producer `packagesOf` deliberately mirrors rather than mints a new code for), so the `ErrorCode` union, the wire, and every other package's rows are unchanged. What widens is the per-package face a consumer reads from `ERROR_CODE_LEDGER['@objectstack/lint']`, newly present where it was absent before. Nothing to migrate.
