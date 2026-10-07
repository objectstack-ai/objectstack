---
"@objectstack/spec": minor
"@objectstack/cli": minor
---

`os migrate meta` stops listing semantic notices whose surface the stack provably does not declare. It counts them instead, and `--all` lists them in full.

Clause-②: yes

- **`SemanticMigration.relevantWhen`** (`@objectstack/spec/migrations`) is a new optional field. It holds a structured question over the loaded stack, `{ kind: 'stack-declares', keys: [...] }`: does the stack declare anything under one of these top-level keys? A key's value in a `packages[].manifest` body counts the same as a top-level value. The question is closed and named. It is never free text, and it never matches against the prose of `surface`. The new types `SemanticRelevance`, `StackDeclaresRelevance` and `SemanticRelevanceKey` are exported beside `SemanticMigration`.
- **`applyMetaMigrations`** asks each entry's question of the stack it is given and of every hop checkpoint. It returns the new `absentTodos`, on the chain result and on each hop, with the entries whose question answered `absent` in all of them. `todos` keeps every other entry. Together the two arrays hold every semantic entry of every hop crossed, each once and in chain order. Entries move only on a positive proof. These cases answer `unknown` and keep the entry listed:
  - a value the question cannot read (a function, a promise, a scalar, a getter that throws);
  - a stack that is not a plain object;
  - any `plugins` / `devPlugins` entry, since a plugin can register metadata the stack does not show.

  An entry that judges a conversion which applied an edit in the same run also stays listed. A consumer that reads only `todos` gets the entries this stack may owe. The rest are in `absentTodos`.
- **The first batch is 29 entries** (5 from protocol 17, 24 from protocol 18). Each one's surface lives only under named top-level stack keys: `analyticsCubes`, `apis`, `jobs`, `mappings`, `hooks`, `agents`, `tools`, `dashboards` (with `reports` and `pages` for the chart-config entry), `datasets`, `permissions` and `sharingRules`. Each entry was also checked to confirm that its acceptance criteria send the author to no stored row and no runtime door. Every other entry is listed exactly as before.
- **`os migrate meta`** prints one line after the listed notices. It counts the entries proven absent and names `--all`. A second line says that the proof covers the stack this run loaded, and not metadata a deployment stores. `--all` prints each of those entries in full, with the keys it was proven absent under. `--json` always carries them under `absentTodos`, and under `hops[].absentTodos` with `--step`. `--step` adds a `not listed` count to each hop line. A run whose only notices are proven absent still writes `--out`.
