---
"@objectstack/spec": minor
---

feat(spec): refuse `${…}` placeholder syntax in memory `persistence.path` / `persistence.key` at publish (#8495)

**BREAKING** accept-set narrowing, landing after the v17.0.0 cut (the lockstep
launch-window convention ships it as `minor`; the migration prescription is
registered under protocol major 18, where `os migrate meta` users will look).

The #8336 defect one surface over: a `${…}` placeholder written in the memory
driver's persistence config (e.g. `persistence: { type: 'file', path:
'${DATA_DIR}/mem.json' }`) is resolved by **nothing** — the driver would create
and write a literal `./${DATA_DIR}/…` path, or write under the literal
placeholder-bearing localStorage key, with no error naming the unresolved
placeholder. #8336's ruling (refuse loudly at authoring time — the value was
authored under a false belief) applies to these two keys with its reason
intact: they are config-material like the connection keys, not record data.

**What is refused:** a complete `${…}` span in memory `persistence.path` (file
persistence and the `auto` override) or `persistence.key` (localStorage and the
`auto` override) — the same shared judgment (`placeholderFree`) the
connection-material keys use, so the policy cannot drift per key.

**What stays accepted:** every literal path/key byte-identically, including
placeholder-looking near-misses (`$VAR`, `{name}`, an unclosed `${`) — and the
memory driver's `initialData` stays deliberately **unjudged**: it carries
arbitrary record values, where a literal `${…}` may be legitimate data (the
mother ruling's deliberate memory-driver exclusion, which reached exactly as
far as its reason did).

## FROM → TO

```ts
// before — parsed green; the driver created a literal `./${DATA_DIR}/…` path
defineDatasource({
  name: 'scratch', driver: 'memory',
  config: { persistence: { type: 'file', path: '${DATA_DIR}/scratch.json' } },
})

// after — write the literal path (or leave it unset: the shared datasource
// factory scopes the default destination per datasource)
defineDatasource({
  name: 'scratch', driver: 'memory',
  config: { persistence: { type: 'file', path: './data/scratch.json' } },
})
```

There is deliberately **no automatic rewrite**: the placeholder names a value
that exists only in the author's intended deployment environment, which a
source-file transform cannot know. `os migrate meta` surfaces the change as a
structured TODO (semantic entry `memory-persistence-placeholder-refused`,
protocol major 18 — this refusal is not part of the v17.0.0 cut).

<!-- adr-0087: registered memory-persistence-placeholder-refused -->
