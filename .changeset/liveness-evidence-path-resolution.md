---
"@objectstack/spec": patch
---

fix(spec): the liveness gate's stale-evidence check was ~100% false positives — and it was burying a real one

The check was one line:

```ts
const file = String(led.evidence).split(':')[0];
if (/\//.test(file) && !existsSync(join(repoRoot, file))) → flag
```

i.e. it assumed every `evidence` string is exactly `path/to/file.ts:123`. Almost
none are — they carry prose (`packages/spec/src/stack.zod.ts (mergeActionsIntoObjects
stable-sorts each group)`), multiple pointers, or a cross-repo attribution
(`objectui: packages/app-shell/…`). Taking everything before the first colon
turns that prose into the "filename", which never exists.

Result: **48 of 227 entries flagged, every one a parse artefact or a deliberate
cross-repo pointer.** A permanently non-empty, ~100%-false warning is a warning
nobody reads — which is exactly how the one genuine rot in that list went
unnoticed:

- **`object.enable.clone`** cited `packages/objectql/src/protocol.ts:2259`. That
  file no longer exists; `cloneData()`'s `enable.clone` gate moved to
  `packages/metadata-protocol/src/protocol.ts:2938`. The claim stayed true, the
  pointer rotted, and the check that exists to catch precisely this could not be
  heard over the noise. Pointer repaired and dated.

**New `evidence.mts`** extracts repo-rooted paths properly and honours the
cross-repo attribution entries already write in prose:

- a realm marker (`objectui`, `cloud`, `ee`) attributes the paths after it, up to
  the next clause boundary, so one string can cite both repos; `framework`
  switches back explicitly;
- `packages/services/service-ai/…` is always foreign — the closed cloud runtime,
  the one sibling missing from this repo's `packages/services/`;
- non-repo-rooted tokens (`app-shell/MetadataProvider.tsx`,
  `action-button/-group`) read as prose, neither resolved nor reported.

The gate now resolves **156 evidence paths** against the checkout, attributes 36
to another repo, and reports **zero** stale — down from 48 warnings that said
nothing. Each run prints the two counts, so the check degrading to "extracts
nothing" is visible rather than silently green (a unit test asserts it too).

Also updates the ledger README, whose advice to write objectui paths "as prose to
avoid false stale-flags" was a workaround for this bug: write the full path with
a realm prefix instead.
