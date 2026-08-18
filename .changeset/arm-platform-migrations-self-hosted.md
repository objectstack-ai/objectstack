---
"@objectstack/metadata-protocol": minor
"@objectstack/objectql": minor
"@objectstack/runtime": minor
"@objectstack/cli": patch
---

fix(metadata-protocol): arm the three `kernel:ready` platform-table migrations on a self-hosted boot, and keep the read-only CLI commands read-only (#9380)

<!-- adr-0087: not-required (no-migration-prescription) One new optional
declaration (`runPlatformMigrations`) added to three existing option bags and
one Zod boot config. Nothing authorable is renamed, retired or tombstoned, so
there is no conversion to register. The behavioural change is that three
migrations which never ran on a self-hosted install now run on its serving
boot. -->

`assembleMetadataProtocol` arms three `kernel:ready` migrations — #5839's
`sys_view_definition` active-row index, #8629's `sys_setting` row-identity
index, and #8686's seed/API tenancy backfill — behind one gate whose own comment
states the intent: *"platform / standalone kernels own their local sys_metadata;
per-project (cloud) kernels source metadata from the control plane and must NOT
provision these tables locally."* So standalone was always meant to be on the
INSIDE of that gate.

It never was. The gate **deduced** ownership from `environmentId === undefined`,
and `runtime/src/standalone-stack.ts` stamps `'proj_local'` on every boot — so
the block never ran on a self-hosted install at all. #8686's own header calls
its `kernel:ready` half the one that "repairs an install that is ALREADY in that
state, which covers every existing deployment"; on self-hosted it covered none,
and those installs kept minting duplicate business identifiers.

**The fix is a declaration, not a wider deduction.** `environmentId` is a
row-scoping key, not a topology signal — the same lesson `authoringChannel`
already records one field above it in the same options bag. A new optional
`runPlatformMigrations` is threaded from the host that knows the answer down to
the one assembly both protocol mounts share:

- `AssembleMetadataProtocolOptions` / `MetadataProtocolPluginOptions` /
  `ObjectQLPluginOptions` gain `runPlatformMigrations?: boolean`;
- `createStandaloneStack` gains the same key and **defaults it to `true`** — a
  standalone kernel owns its local platform tables, whatever environment id it
  stamps rows with;
- the predicate is exported as `shouldRunPlatformMigrations(environmentId,
  declared)` so the default lives in exactly one place.

**Undeclared means unchanged.** The default is `environmentId === undefined`,
the historical deduction, so every caller that does not declare — including
cloud's per-project kernels (`createMetadataProtocolPlugin({ environmentId })`)
and the control-plane assembly (`createMetadataProtocolPlugin()`) — keeps
today's behaviour exactly.

**The read-only contract is preserved, and not by keying on deferral.** The
CLI's one-shot boot funnel (`bootSchemaStack`) declares
`runPlatformMigrations: false` for every `os migrate *` / `os meta *` command.
Keying it on `deferSchemaDdl` would have covered only `os migrate plan` and
`os migrate duplicates`; `os migrate summary-nulls`, `value-shapes`,
`recorded-by`, `resume`, `files-to-references` and `os migrate meta` all boot
**non-deferred** and are still dry-run-by-default ("a dry run writes NOTHING"),
so that half would have quietly repaired rows behind a report. The serving boots
— `os dev`, `os serve`, `os start` — do not come through that funnel and take
the default, which is where an install now gets repaired.

Proven on real kernels over a real SQLite file carrying the real #8686 damage,
not on the predicate: the serving boot merges the split counter and adopts the
movable seed row while leaving the colliding one reported-not-renumbered; the
deferred and non-deferred one-shot boots both leave the data untouched; and a
per-project kernel assembled cloud's way still repairs nothing.
`os migrate duplicates`' own byte-identical-after-run pin
(`duplicates.integration.test.ts`) still passes unchanged.
