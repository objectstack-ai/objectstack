---
'@objectstack/cloud-connection': patch
---

fix(cloud-connection): install-local answers a composed artifact the resolver refuses with the resolver's 422 at the declared-rename step, not a 503 telling the author to retry

Clause-②: no
Metadata-protocol: none

The declared-rename step of `POST /api/v1/marketplace/install-local` (step 2c″) reads every package body of a composed artifact through the artifact resolver. When the resolver refused the artifact, the step answered `503 SERVICE_UNAVAILABLE`: "the tables its declared rename(s) carry could not be read … Retry once the database answers." Examples are a `packages` that is not a list, or a package entry that carries a retired bare `indexes[].unique: true`. A retry never helps, and the author looked for the fault in the wrong place.

The step now resolves the bodies before it reads any table. A refusal answers with the resolver's own declared status and code: `422 INVALID_ARTIFACT_PACKAGES` or `INVALID_ARTIFACT_PACKAGE_ENTRY`, with the resolver's sentence. Nothing is written. This is the answer the `isolated`-posture unique-scope gate already gives for the same bytes, through the same reader. An undeclared throw out of the resolver, such as a dependency cycle between two packages of one artifact, is rethrown and is not relabelled. The 503 now means only that a table could not be read.

The door reaches this step first only on a runtime that predates the install-time code judgements (`collectJobsWithoutBody`, `collectHooksWithoutBody`). A runtime that carries them resolves the packages earlier, so its answer does not change.
