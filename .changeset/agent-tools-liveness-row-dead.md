---
"@objectstack/spec": patch
---

fix(spec): the `agent.tools` liveness row is `dead` — it claimed `live` on a key the schema tombstoned

`liveness/agent.json` ships inside this package, and its `tools` row read:

```json
"tools": { "status": "live", "evidence": "cloud: packages/service-ai/src/agent-runtime.ts", "note": "legacy direct-tool fallback." }
```

`agent.tools` was removed in protocol 17 (#3894). `src/ai/agent.zod.ts` declares it
`retiredKey(...)`, which types the key `never` and rejects any authored value with the
upgrade prescription, and the ADR-0087 conversion `agent-tools-to-skills` deletes it from
stored rows and built artifacts when the chain is replayed at rehydration. So nothing can
carry a value for the key and no consumer in any repo can read one — while the ledger's own
vocabulary defines `live` as "Has a runtime consumer".

The verdict moves `live` -> `dead` with **no key added or removed**: the classified total
stays at 1094 and the accept set is byte-identical, because a liveness row is a claim about
the schema rather than the schema. `dead` is the status the ledger's own convention already
gives this class — of the 40 tombstoned top-level keys across the 36 governed types, 39
were already `dead` and this was the only outlier — and it is what puts the key on the
ADR-0049 enforce-or-remove worklist it should have been on since protocol 17. `live-elsewhere`
is refused rather than left undeclared: that status needs a genuine foreign enforcer, and a
key nothing can carry a value for has nothing to enforce.

Nothing changes for authors: writing `agent.tools` failed `tsc` and failed the parse before
this change and fails both after it. What changes is that the ledger, which ships in this
tarball and is the input to the retirement worklist, no longer certifies a consumer that does
not exist.

Also in this change: the stale `evidence` pointer is deleted rather than repointed (a `dead`
row's pointer lives in its `note` by the gate's own design), the ledger's own `_note`
sentence saying the row was deliberately left unstamped is corrected to record the landed
re-grade, `liveness/state-counts.md` is regenerated, and a contract test pins the class —
a `[REMOVED]` tombstone's ledger row says `dead`, on a measured population of 40.
