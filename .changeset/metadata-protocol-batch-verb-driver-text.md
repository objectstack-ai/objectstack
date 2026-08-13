---
'@objectstack/metadata-protocol': patch
---

Stop putting caught driver text on the batch verbs' response payloads (#8333).

`publishPackageDrafts`, the publish side effects and their materializer, the seed
apply, `duplicatePackage`, `revertCommit`, `rollbackToPackageCommit` and
`migrateStoredMetadata` each reported a failure by copying the caught error's
sentence onto a field of the response — `failed[].error`, `materializeApplied`'s
`failures[].error`, `seedApplied.error`, `rows[].reason`. Those are DATA, not
messages, so no HTTP boundary's 5xx message withhold ever reached them: a
`sys_metadata` outage shipped `SQLITE_ERROR: no such table: sys_metadata` to the
client on an otherwise successful-looking response.

All eight now follow the rule #8136 installed for the uninstall cluster: a caught
sentence is quoted back only when that error **declared itself a client-facing
refusal** (a 4xx `status` in the ADR-0112 envelope). Anything else gets a stable
sentence and the original goes to the server log, which these sites did not
previously write at all.

Authoring feedback is unaffected, and that was measured before anything changed
rather than assumed. Every authored refusal reaching these collectors already
declares 4xx, so it is still quoted verbatim — a failed package publish still
tells the author which field of which draft is wrong, with its `code` and
structured `issues` intact.

One producer needed declaring rather than converting: `applySeedBodies` parsed
the seed request with `SeedLoaderRequestSchema.parse()`, so a malformed seed body
surfaced as a raw `ZodError` that declared nothing. It is now a `safeParse` that
raises a real `422 INVALID_METADATA` envelope, so `seedApplied.error` carries the
same curated, path-pointing summary every other authoring surface produces
instead of a multi-line dump of zod internals.
