---
"@objectstack/spec": patch
---

ADR-0087 semantic-migration ledger: register the retirement of `@objectstack/core`'s `PluginSecurityScanner` (#14919)

`PluginSecurityScanner`, `ScanTarget` and `SecurityIssue` are removed from
`@objectstack/core` in the same PR, under ADR-0049 enforce-or-remove (maintainer
ruling 2026-09-05, director summon #14, decision batch #42). This is the ledger
half: a D3 semantic entry
(`src/migrations/entries/semantic/18.plugin-security-scanner-retired.ts`,
concatenated into `MIGRATIONS_BY_MAJOR[18].semantic` by `gen:migration-registry`)
so the retirement reaches `spec-changes.json` and the generated upgrade guide
rather than being invisible to every upgrade channel.

FROM `new PluginSecurityScanner(kernel.logger)` → TO nothing: delete the import
and every call. There is no replacement export, and a caller that branched on
`result.status === 'passed'` takes that branch unconditionally — it is the only
branch the scanner ever produced, because four of its five scan methods returned
an empty issue list on every input and the fifth read a vulnerability database
whose only writer had zero callers.

Why an entry is owed at all, and why D3 rather than a D2 conversion: the class
has no spec schema and never had one. It is a runtime TS class, so there is no
authorable key to tombstone with `retiredKey()` and no stored `sys_metadata` row
a conversion could rewrite — a scanner was constructed per call and every result
lived in a per-instance Map discarded with the object, so
`applyConversionsToStoredItem` has no seam that would ever see one. The enforced
channel is tsc at the consumer's own import site; for anyone it does not reach,
this entry and the upgrade guide are the only channel. That is the
`contracts.IDataDriver.findStream` and `actor-user-roles-to-positions`
disposition, applied to a surface one layer further out than either — those are
declared in `packages/spec`, this one only in `packages/core`.

Measured, and worth recording because the entries README warns of a regeneration
lap that did not materialise here: `check:generated` reports all 15 artifacts up
to date after the entry landed, and running `gen:spec-changes` and
`gen:upgrade-guide` explicitly moved neither file — a major-18 semantic entry is
not yet projected into either. `registry.ts` is the whole generated diff.

No behaviour in `@objectstack/spec` changes; this adds a ledger row and the
regenerated region that carries it.
