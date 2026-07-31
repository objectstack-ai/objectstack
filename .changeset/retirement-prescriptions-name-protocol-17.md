---
'@objectstack/spec': major
'@objectstack/metadata-protocol': patch
'@objectstack/client': patch
'@objectstack/service-automation': patch
---

fix(spec)!: the #3963 / #4052 / #4158 / #4196 / #4286 retirements land in protocol **17**, not a protocol 18 that this train cannot produce (#4350)

Ten tombstone prescriptions told authors a key "was removed in `@objectstack/spec` **18**",
and — worse — the machine agreed with them: a whole `step18` chain step and two
`toMajor: 18` conversions were wired for a major the release train does not reach.

**17 is what ships.** `latest` is 16.1.0 and `rc` is `17.0.0-rc.0` — 17.0.0 has never been
published. `.changeset/pre.json` records `@objectstack/spec` at initialVersion 16.1.0, and
changesets computes a pre-mode bump from the last *published* version: 16.1.0 + `major` =
**17.0.0**, released as `17.0.0-rc.N`. `PROTOCOL_VERSION` is `'17.0.0'`, and
`protocol-version.test.ts` pins it to the package major, so it cannot unilaterally become 18
either. The "18" came from counting up from the in-flight `17.0.0-rc.0` instead of from
16.1.0.

**The prose was the smaller half.** `composeMigrationChain(from, to = PROTOCOL_MAJOR)`
filters `m <= toMajor`, so a step keyed 18 was **unreachable**: `os migrate meta --from 16`
walked steps 11–17 and silently skipped 18. The same ceiling applies to `composeSpecChanges`,
so the generated `spec-changes.json`, `docs/protocol-upgrade-guide.md` and the `spec_changes`
MCP tool — the ADR-0087 D4 primary channel — carried **none** of these seven retirements:
`query.joins`, `query.windowFunctions` and `BatchOptions.validateOnly` appeared zero times in
the committed manifest, and the upgrade guide contained no "18" at all. Authors would have hit
the tombstones with no chain hop to run and no upgrade-guide row to read.

What changed:

- `step18` is folded into `step17` — its rationale, both `conversionIds`
  (`stack-api-require-auth-removed`, `flow-node-wait-timeout-keys-removed`) and all six
  semantic migrations move across, and `MIGRATIONS_BY_MAJOR[18]` is gone. Both conversions
  become `toMajor: 17` (`migrations.test.ts` requires a conversion's `toMajor` to equal its
  step's major), and `CONVERSIONS_BY_MAJOR[18]` merges into `[17]`.
- All 30 hand-written "18" references become "17": the ten tombstone prescriptions
  (`query.zod.ts`, `flow.zod.ts`, `rest-server.zod.ts`, `stack.zod.ts`, `protocol.ts`), the
  `query.test.ts` pin regex that was holding the wrong number in place, the internal comments,
  the `liveness/query.json` + `liveness/README.md` notes, and the seven unconsumed changesets.
- The seven retirements are written into the v17 release notes and upgrade checklist, where
  they had no entry at all — there is no `v18.mdx` for them to have landed in.

No behaviour is added or withdrawn: every key retired by #3963, #4052, #4158, #4196 and #4286
stays retired, on exactly the terms those changesets describe. What changes is that the
prescription now names the version that will actually carry it, and `os migrate meta` actually
applies the two stack conversions instead of stepping over them.
