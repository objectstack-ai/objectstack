---
"@objectstack/spec": minor
---

fix(spec): `connector` preserves the ADR-0010 protection envelope instead of silently stripping it (#6362)

`ConnectorSchema` tolerated the ADR-0010 protection envelope but never declared
it, so every package-load round-trip through the schema dropped
`_packageId` / `_packageVersion` / `_provenance` / `_lock` / `_lockReason` /
`_lockSource` / `_lockDocsUrl` — all seven keys, with no error anywhere.
Tolerate is not preserve.

Both metadata load paths call `applyProtection` on **every** type, so a
package-loaded connector carries that envelope by the time anything re-parses
it — and since #6245 bound `DeclarativeConnectorEntrySchema` to
`PUT /api/v1/meta/connector/:name`, something re-parses it on every write.

This is the quiet half of the pair #6245 fixed, and being quiet is why it
outlived its siblings. `sharing_rule` is `.strict()`, so its undeclared
envelope was **rejected** — a hard 422, loud, fixed in #6245 the moment the
door was bound. `ConnectorSchema` is a plain (non-strict) `z.object`, so it
**accepted** the same envelope, answered `success`, and stripped it from the
output. Every downstream reader of `extractProtection` / `resolveLockState`
therefore saw an unlocked, unattributed, `org`-provenance connector where the
loader had stamped a locked, package-owned one.

FROM: a stamped connector round-tripping through the schema came back having
lost all seven envelope keys, silently.
TO  : all seven survive, by value, on the base schema, on the `/meta` write
door, and through the metadata registry's own lookup.

The fix is the one #6245's dev verified on `sharing_rule` — a single
`...MetadataProtectionFields` spread. Pure-additive and internal: every key is
`_`-prefixed and optional, no author-facing field changes, and nothing that
parsed before stops parsing. `ConnectorSchema` stays non-strict, so an
undeclared `_`-prefixed key is still stripped rather than accepted; the spread
adds seven named keys, not a passthrough.

**`webhook` was measured in the same pass and needs no change.** The issue
asked whether it had the same drop; it does not. `WebhookSchema` has carried
this spread since #4001 batch 11 and all seven keys already survive its
round-trip. That reading is now pinned by a test rather than left as a note,
so it cannot regress unobserved.

The generated authorable-surface baselines gain the seven `_`-prefixed keys
under `integration/Connector`, matching what #6245 recorded for
`security/SharingRule` and `security/CriteriaSharingRule`.
