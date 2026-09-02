---
"@objectstack/cli": patch
---

fix(cli): `os generate flow` scaffolds a flow `os validate` accepts (#14087)

The `flow` scaffold could not survive its own toolchain. Measured on 17.2.0,
`os g flow my_flow` followed by `os validate` produced four refusals in one
parse:

```
flows[0].nodes[0].label  expected string, received undefined
flows[0].nodes[0]        unrecognized key(s): `name`, `next`
flows[0].edges           expected array, received undefined
flows[0]                 unrecognized key(s): `trigger`
```

`FlowSchema` is `.strict()` and has never declared a top-level `trigger` on
protocol 17. A record-change flow binds on the START node's `config` —
`{ objectName, triggerType, condition }` — which is where
`AutomationEngine.resolveTriggerBinding` reads it from. The scaffold also wrote
an `events: ['after_insert', 'after_update']` vocabulary that exists nowhere on
the current surface, and named a single node it then pointed at a node it never
emitted.

So the first flow anybody scaffolded was a file their own `os validate`
rejected — against a `.strict()` error enumerating what is allowed rather than
saying where the trigger had moved to.

The template now emits the shape the schema accepts and the engine binds:
`type: 'record_change'`, a labelled START node carrying
`config: { objectName, triggerType: 'record-after-write' }`, a labelled END
node, and the `edges` array joining them. `status` stays `'draft'` — the arming
decision is the author's, and `os validate` says so.

`generate-scaffold-validates.test.ts` puts every generator's output through the
two steps `os validate` runs on an authored stack (schema parse, then the
author-time rule registry), loaded through the same `bundle-require` path
`loadConfig` uses, so the generator and the schema cannot drift apart again
silently. Both layers are needed: a flow node's `config` is an open slot
(ADR-0018), so the schema cannot judge the trigger vocabulary at all — the
`record-*` grammar is held by `validate-flow-trigger-readiness` one layer
later.

No other generator's output changed. Four of them (`object`, `view`, `action`,
`app`) are refused for unrelated reasons of their own; the new test records
them in a shrink-only ledger that fails when one is repaired and its entry is
left behind.
