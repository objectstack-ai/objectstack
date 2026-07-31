---
"@objectstack/metadata": patch
---

fix(metadata): the `artifact-api` source is declared as what it is — implemented (#4246)

`MetadataPluginOptions.artifactSource` carried a type comment saying "Only
`local-file` is implemented now; `artifact-api` is reserved for M3/M4". It had
outlived its subject: `_loadFromArtifactApi` ships, and all three bootstrap
branches (`eager` / `lazy` / `artifact-only`) dispatch to it. A caller reading
the comment would conclude `mode: 'artifact-api'` was inert; supplying it plus
`environmentId` boots the server off a real network fetch.

This is Prime Directive #10's `declared ≠ enforced` running backwards — the
declaration understates the runtime instead of overstating it — and it is not
self-correcting: `implementation-status.mdx` copied the claim, so every docs
accuracy audit rediscovers the contradiction and can only re-file it (which is
how this issue was born). The comment, the docs bullet, and the package ROADMAP
now describe the shipped behaviour.

**The test that was supposed to hold the line was passing for the wrong reason.**
`artifact-only bootstrap rejects the not-yet-implemented artifact-api source`
asserted `rejects.toThrow(/artifact-api/)`. The only throw on that path is the
missing-`environmentId` pre-flight guard, whose message merely *contains* the
string `artifact-api` — so the assertion matched while proving nothing about
implementation status. It is replaced by a suite that pins what the loader does:
URL construction from both accepted input shapes, `?commit=` pinning, the Bearer
header, dispatch from each of the three bootstrap modes, a loud failure on a
non-OK response, and the `environmentId` guard asserted on *its own* message.

**One real defect fell out of the audit.** The URL builder chose between "append
the canonical path" and "use the URL as-is" by testing for a
`/api/v{n}/cloud/projects/` segment — a path the v5.0 `project → environment`
rename deleted. The guard had therefore been unmatchable since v5.0: an
already-resolved artifact URL got the canonical path appended a *second* time
(`…/artifact/api/v1/cloud/environments/…/artifact`) and 404'd, so half of this
option's documented input shape was dead. The check is now "does the path
already name an artifact endpoint", which restores the intended dual form and
keeps the `unlisted`-visibility public route (`/pub/v1/environments/:id/artifact`)
addressable. Callers passing a control-plane base URL — the common case, and the
only one that worked — are unaffected.
