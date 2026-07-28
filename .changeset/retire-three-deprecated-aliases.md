---
"@objectstack/spec": major
"@objectstack/cli": patch
---

feat(spec)!: retire the last three deprecated authorable aliases (#3855)

Protocol 17 removes the three keys that a schema transform used to fold into a
canonical slot and drop from the parsed output. Every slot now has exactly one
spelling.

## Migration

| Removed | Use instead | Value shape |
|---|---|---|
| `action.execute` | `action.target` | unchanged — a handler / flow / URL ref |
| `field.conditionalRequired` | `field.requiredWhen` | unchanged — a CEL predicate |
| `agent.knowledge.topics` | `agent.knowledge.sources` | unchanged — a list of source tags |

All three are **pure key renames**. Nothing about the value changes, and no
runtime behaviour changes: each alias was already lowered into its canonical key
at parse time and erased before any consumer saw it, so what shrinks is the
authorable surface, not the semantics.

**Run `os migrate meta --from <your current major>`.** It rewrites your source
mechanically — these renames are registered as protocol-17 chain steps, so the
tool applies all three (and every earlier step you skipped) in one pass. Manual
alternative: rename the key. That is the entire fix.

```diff
- actions: [{ name: 'convert', type: 'script', execute: 'convertHandler' }]
+ actions: [{ name: 'convert', type: 'script', target: 'convertHandler' }]

- fields: { due_date: { type: 'date', conditionalRequired: 'record.stage == "closed"' } }
+ fields: { due_date: { type: 'date', requiredWhen: 'record.stage == "closed"' } }

- knowledge: { topics: ['faq', 'policies'], indexes: ['docs'] }
+ knowledge: { sources: ['faq', 'policies'], indexes: ['docs'] }
```

## Why these reject instead of being ignored

None of the three schemas is `.strict()`, so deleting a key outright makes Zod
**silently strip** it: the metadata would parse clean and the setting would
simply never take effect — a script action bound to nothing, a field that is
never required, an agent recruiting no RAG context. `FieldSchema` already
carries a comment about the last time that happened (`dataQuality` / `cached`,
#3726 / #3733).

So each removed key is **tombstoned**: it stays declared as `never`, which makes
writing it a `tsc` error at the authoring site *and* a parse error carrying the
rename. You cannot lose the setting quietly.

## Where to find this if you missed it

The removal is in the machine-readable change manifest (`spec-changes.json`,
ADR-0087 D4) as three protocol-17 conversions. Per-major manifests **compose**,
so jumping several majors at once still yields a single answer rather than N
changelogs to reconcile — the generated upgrade guide and the `spec_changes` MCP
tool are both projections of that record.

## Also removed

`lintDeprecatedAliases` and its rule-id exports (`ACTION_TARGET_EXECUTE_CONFLICT`,
`FIELD_REQUIREDWHEN_CONDITIONALREQUIRED_CONFLICT`,
`AGENT_KNOWLEDGE_SOURCES_TOPICS_CONFLICT`, `DeprecatedAliasFinding`,
`formatDeprecatedAliasFinding`). That pass existed to warn when an author
declared both an alias and its canonical key, because the parse resolved the
conflict silently. With the aliases gone the parse **rejects** instead, which is
strictly louder — the rule has no subject left. If you imported any of these,
delete the import; there is no replacement because the condition it reported can
no longer occur.

The CLI's inline-handler lowering also stops binding a function on `execute`. It
runs before the parse, so binding it there would have kept the removed alias
quietly working for one authoring style while every other style rejected it.
