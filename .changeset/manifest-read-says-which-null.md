---
'@objectstack/cloud-connection': minor
---

`LocalManifestSource.read()` now says WHICH of the two things its `null` meant

`read()` answered `null` to two different questions at once — "this manifest was
never installed" and "it was installed, but its ledger file cannot be read" —
and dropped the reason for the second in an un-bound `catch`. Two admin
endpoints check `has()` first, so absence was already ruled out by the time they
called it, and both could only answer
`500 { code: 'MARKETPLACE_STORAGE_FAILED', message: 'Failed to read manifest cache.' }`:
a sentence whose only content is that the thing it just did failed, one line
after `has()` said the file is there. The `Unexpected end of JSON input` /
`EACCES` / `EISDIR` that names the repair had already been thrown away, and
nothing was written to the server log either.

**Breaking (`@objectstack/cloud-connection`):** `read()` returns an
`InstalledManifestLookup` instead of `InstalledManifestEntry | null`.

- FROM: `const entry = source.read(id);`
- TO:   `const { entry, failure } = source.read(id);`

`entry` is the old return value unchanged, so a caller that legitimately treats
both nulls alike migrates by reading `.entry`. `failure` is a
`SkippedManifestEntry` — `{ file, cause }`, the same shape `list()` already
reports, with the thrown object carried unwrapped — and is present ONLY when a
ledger file exists and could not be read. `failure === undefined` with
`entry === null` therefore means "not installed", which is the distinction the
merged `null` erased. One new exported type, `InstalledManifestLookup`.

`read()` still does not validate the parsed value's SHAPE, and enumerating the
ledger directory still throws out of `list()` — both unchanged.

Consumer-visible behaviour:

- `POST /api/v1/marketplace/install-local/:manifestId/reseed-sample-data` and
  `…/purge-sample-data` keep returning `500 MARKETPLACE_STORAGE_FAILED` — the
  same failure, so a client branching on the code is unaffected — but the
  message now names the ledger file to repair or remove and quotes the cause
  verbatim, and a matching `warn` line goes to the server log.
- The install path's ADR-0120 D5e posture gate is unchanged on purpose: a
  corrupt entry still counts as "no attestation on record", so the one-time
  installation-wide-unique ceremony is asked again rather than skipped.
