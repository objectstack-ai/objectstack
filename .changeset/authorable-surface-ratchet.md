---
"@objectstack/spec": patch
---

fix(spec): ratchet the authorable key surface — the one contract no witness watched (#3855)

For a metadata-driven platform the third-party API is **what an author may
write**: the keys inside each schema. Nothing guarded them.

The two existing witnesses look at the TypeScript surface instead:

- `api-surface.json` records exported `name (kind)`. A key inside a schema is
  not an export, so removing one never moves it.
- `api-surface-signatures.json` hashes each `defineX` factory's type — but via
  `checker.typeToString()`, which prints a type *reference*
  (`z.input<typeof ActionSchema>`) and never expands it structurally. Member-level
  narrowing cannot reach the hash.

`spec-changes.json` inherits the same blind spot: its `added`/`removed` arrays
are a diff of `api-surface.json`.

So #3883 removed three authorable keys with every witness green — and #3733 did
the same **by accident**, when `dataQuality` / `cached` outlived their keys and
were silently stripped. ADR-0059 §5 deferred a deeper gate "until a narrowing
actually slips both". It has, twice.

**New: `authorable-surface.json`**, a committed ratchet of all 8588 authorable
keys, derived from the same walk that already emits the JSON Schemas — one level
deeper, no new introspection. It distinguishes three states, because a tombstoned
key (`retiredKey()`) is `z.never()`, which Zod renders as `{ "not": {} }`:

| State | Meaning |
|---|---|
| live | a normal property — the author may write it |
| `[RETIRED]` | present but unwritable, carrying its own upgrade prescription |
| absent | gone from the contract with nothing left to say |

Three failure modes now fail the build, each verified non-vacuous by simulation:

1. **A key vanishes without a tombstone.** These schemas are not `.strict()`, so
   Zod silently strips an unknown key: the author gets a clean parse and a
   setting that never takes effect. The error spells out the retirement protocol.
2. **A key is tombstoned with no registered migration.** The tombstone is audible
   to whoever hits it, but the change documentation — `spec-changes.json`, the
   generated upgrade guide, the `spec_changes` MCP tool, `os migrate meta` — is
   still empty. Requires a D2 conversion / D3 chain entry naming the surface.
3. **An addition is left uncommitted** (`--check`). An unrecorded key is
   invisible to the ratchet forever after, since it can only detect the
   disappearance of something it once saw.

It runs in `check:docs` (unconditional, required — cannot go dormant) and as an
explicit `check:authorable-surface` step in `Check Generated Artifacts`, with the
paths filter widened in lockstep per that filter's own rule.

Also corrects the `build-api-surface.ts` docblock, which advertised the signature
snapshot as answering "did the accepted authoring shape narrow?" — it does not,
and believing it did is what let this gap sit. Value-level narrowing (an enum
losing a member) remains ungated, per ADR-0059 §5's evidence gate.
