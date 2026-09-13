---
"@objectstack/spec": minor
---

feat(spec)!: retire the `scheduled` cache-warmup strategy — the cron it selected left in this same major, and nothing ever warmed on a cadence (ADR-0049)

<!-- adr-0087: registered cache-warmup-scheduled-strategy-retired -->

**BREAKING** in the accept-set sense, landing in the launch window as `minor` (the
lockstep convention: `major` is refused by `check-changeset-no-major`, and breaking-ness
is carried by this banner plus the ADR-0087 disposition above).

`CacheWarmup.strategy` no longer accepts `'scheduled'`.

| | before | after |
|:--|:--|:--|
| accept set | `'eager' \| 'lazy' \| 'scheduled'` | `'eager' \| 'lazy'` |
| describe | `… lazy (on first access), scheduled (cron)` | `… lazy (on first access)` |
| a document writing it | parsed green | **refused**, with the prescription |

**The one-line fix:** write `strategy: 'eager'` (warm at startup) or `strategy: 'lazy'`
(warm on first access). For a warmup on a **cadence**, declare a `job` — that is the one
cron slot this platform evaluates:

```ts
defineStack({
  jobs: [{ name: 'warm_config_cache', schedule: { expression: '0 * * * *' }, handler: 'warmConfigCache' }],
});
```

## Why

`cron-typed-positions-retired` (17.x → 18, #16320) deleted `CacheWarmup.schedule`, the
cron key this enum member selected, and left the member standing on the reading that it is
"a value, not a position the ruling names". That was a statement about that ruling's
**scope**, not a finding that the value was sound. After the deletion the member declared a
warmup cadence with **no key left to configure it and no engine that has ever run one**,
while its own `.describe()` still promised `(cron)` — ADR-0049 declared-not-enforced, in
the form Prime Directive 10 names outright: a capability advertised that the runtime does
not deliver.

Nothing on the platform reads `CacheWarmupSchema`: outside its declaring file it resolves
to the generated reference page's import line, the `declaration-map` / `export-origins`
catalogues, the ADR-0058 D7 ledger comment and two of this package's own test files — zero
runtime consumers, measured beside a lit control (`ConnectorSchema`, 46 files, same sweep).
So **no runtime behaviour changes**: no warmup has ever run on a schedule, before or after.
What changes is that the contract stops promising it.

## The retirement kit

- the member leaves `z.enum(['eager','lazy','scheduled'])` and the `.describe()` stops
  saying `(cron)` (`system/cache.zod.ts`)
- the prescription hangs on **the enum's own `error` map, dispatched by `issue.input`** —
  the established route for an enum-VALUE retirement (`crypto.hash` on
  `HookBodyCapability`, `object.managedBy: 'system'`, `HotReloadConfig.stateStrategy`).
  There is no value-level analogue of `retiredKey()` and none is invented here. Only the
  value that **used to be legal** gets the "was removed" sentence; `strategy: 'sheduled'`
  keeps zod's own enum message, which already lists the legal values
- an **ADR-0087 D3 semantic entry**, `cache-warmup-scheduled-strategy-retired` — a semantic
  entry rather than a D2 conversion because there is **no source to rewrite**: `CacheWarmup`
  is bound to no metadata type and embedded in no stack collection, so no authored document
  and no stored row has ever carried this value, and `os migrate meta` has nothing to list.
  That is also why the prescription carries **no `os migrate meta` sentence** — it would
  promise a listing the tool cannot produce, which is the very defect this card is about
- **nothing in `RETIRED_KEYS_BY_MAJOR`** — no authorable *key* changed — and **no
  `retiredKey()` tombstone**, which tombstones keys, not values
- pin tests (`system/cache.test.ts`): the refusal and its prescription, a **lit control**
  that a typo is *not* told it "was removed", and that the surviving members and the
  `'lazy'` default still parse. `cron-typed-positions-retirement.test.ts`'s warmup fixture
  moves to `'eager'`, since a fixture must be well-formed under the current schema

## ⚠️ The four surface ratchets are byte-identical across this change, and that is correct

An enum-VALUE narrowing moves no position, no exported name and no expression-typed slot:
`authorable-surface/` keys on **positions** (`system/CacheWarmup:strategy` stays — the key
is untouched), the ADR-0058 D7 ledger on **expression-typed slots**, and `api-surface/` /
`json-schema.manifest/` on **names**. None of them reads a def's *value set*, so none of
them can fail on this change — the `crypto.hash` precedent measured exactly this. The pin
tests above are therefore not a formality: they are the only instrument this retirement
has, and a green CI run on its own says nothing about whether the value is gone.
