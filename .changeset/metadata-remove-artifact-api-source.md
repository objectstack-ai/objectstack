---
"@objectstack/metadata": major
---

refactor(metadata)!: remove the `artifact-api` artifact source (#4246)

`MetadataPluginOptions.artifactSource` loses its `artifact-api` union member;
`{ mode: 'local-file', path }` is now the single artifact source. The
`_loadFromArtifactApi` loader, its `environmentId` pre-flight guard, and the
Bearer-token support in `_fetchJson` go with it.

**Why removal, not the doc fix this branch first carried.** #4246 found the
declaration and the implementation contradicting each other — the option's
comment called `artifact-api` "reserved for M3/M4" while the loader shipped and
all three bootstrap modes dispatched to it — and asked the owner to pick a
direction. Auditing both repos to answer that settled it:

- **Zero consumers anywhere.** No `mode: 'artifact-api'` call site exists in
  this repo or in cloud. The two real "pull an artifact from the cloud" paths
  both bypass it: the cloud runtime uses its own `ArtifactApiClient` (TTL
  cache, singleflight, hostname resolution, runtime config injection — a
  superset this option was never going to grow into), and package distribution
  into a running OSS instance goes through `@objectstack/cloud-connection`
  (`os package install`, ADR-0008).
- **Half its input contract had been dead since v5.0 with no one noticing.**
  The URL builder decided "append the canonical path vs use as-is" by testing
  for an `/api/v{n}/cloud/projects/` segment that the v5.0
  `project → environment` rename deleted, so every already-resolved URL got
  the path appended a second time and 404'd. A year of silence on a bug like
  that is consumer-count evidence of its own.
- **Its one non-replaceable capability was declined.** A Bearer-authenticated
  pull of a *private* environment artifact is the single thing `local-file`
  cannot do (`local-file` URLs fetch verbatim, unauthenticated). The owner
  confirmed that sealed-private-artifact deployments are not a supported need
  right now, which removed the last reason to keep the mode.

**Migration.** Public or commit-pinned artifacts load through the existing
`local-file` URL form, which every bootstrap mode already honors:

```ts
artifactSource: {
  mode: 'local-file',
  path: 'https://cloud.example.com/pub/v1/environments/env_42/artifact?commit=cmt_1a2b',
}
```

(`private` environments still serve exact-commit deep links through the same
`/pub` route; fully private pulls have no replacement — by decision, not
oversight.) For installing packages into a running runtime, use
`os package install` / `@objectstack/cloud-connection`.

**The removal is loud, not silent.** A still-configured `artifact-api` source
(reachable from JS or `any`-typed config now that the TS union is
single-member) throws at `start()` with the migration pointer above. This
guard exists because the dispatch's old fall-through would have treated
"unsupported source" as "no source" — under `eager` that silently scans the
filesystem instead of loading the artifact the caller named. Tests pin the
rejection in `artifact-only` and `eager`, and pin the migration target
(`local-file` fetching an http(s) URL and registering the envelope) so the
path the error message points at stays real.

Also replaces a test that passed for the wrong reason: "artifact-only
bootstrap rejects the not-yet-implemented artifact-api source" matched
`/artifact-api/` against the missing-`environmentId` guard's message — which
merely contained the string — proving nothing about implementation status.
The doc comment, `implementation-status.mdx`, `metadata-service.mdx`, and the
package ROADMAP now all describe the single `local-file` source, ending the
docs-audit loop #4246 was filed to stop.
