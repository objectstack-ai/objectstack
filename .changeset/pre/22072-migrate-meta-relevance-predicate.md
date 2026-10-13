---
"@objectstack/spec": minor
"@objectstack/cli": minor
---

`os migrate meta` stops listing semantic notices whose surface the stack provably does not declare. It counts them instead, and `--all` lists them in full.

Clause-②: yes

- **`SemanticMigration.relevantWhen`** (`@objectstack/spec/migrations`) is a new optional field. It holds a structured question over the loaded stack, `{ kind: 'stack-declares', keys: [...] }`: does the stack declare anything under one of these top-level keys? A key's value in a `packages[].manifest` body counts the same as a top-level value. The question is closed and named. It is never free text, and it never matches against the prose of `surface`. The new types `SemanticRelevance`, `StackDeclaresRelevance` and `SemanticRelevanceKey` are exported beside `SemanticMigration`.
- **`applyMetaMigrations`** asks each entry's question of the stack it is given and of every hop checkpoint.
  - **`todos` is unchanged.** `MigrationChainResult.todos` and `MigrationHopResult.todos` still hold every semantic entry of every hop crossed, whatever the stack holds, as before.
  - **`absentTodos` is a new required member** of `MigrationChainResult` and `MigrationHopResult`. It names the subset of `todos` whose question answered `absent` in all of them: the same objects, in chain order. Code that only reads a chain result needs no change. Code that builds one of these two interfaces itself must now supply `absentTodos` (an empty array when nothing is proven absent).
  - **Only a positive proof names an entry.** These cases answer `unknown` and leave it off `absentTodos`:
    - a value the question cannot read (a function, a promise, a scalar, a getter that throws);
    - a stack that is not a plain object;
    - any `plugins`, `devPlugins` or `tiers` entry, since a plugin, or the platform plugins a tier preset loads, can register metadata the stack does not show.

    An entry that judges a conversion which applied an edit in the same run is never named either.
- **The first batch is 25 entries** (5 from protocol 17, 20 from protocol 18). Each one's surface lives only under named top-level stack keys: `analyticsCubes`, `apis`, `jobs`, `mappings`, `hooks`, `agents`, `tools`, `dashboards` (with `reports` and `pages` for the chart-config entry), `datasets`, `permissions` and `sharingRules`. None of them names a code door. Each entry was also checked to confirm that its acceptance criteria send the author to no stored row and no runtime door. Every other entry is never named absent, so it is listed exactly as before.
- **`os migrate meta`** lists `todos` minus `absentTodos`. After the listed notices it prints one line that counts the entries proven absent and names `--all`. A second line says that the proof covers the stack this run loaded, and not metadata a deployment stores.
  - `--all` prints each of those entries in full, with the keys it was proven absent under.
  - `--json` keeps `todos` whole and adds `absentTodos`, plus `hops[].absentTodos` with `--step`.
  - `--step` reports each hop's listed count, and adds a `not listed` count to the hop line when that count is not zero.
  - A run whose only notices are proven absent still writes `--out`.
