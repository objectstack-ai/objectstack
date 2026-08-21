---
"@objectstack/metadata-core": minor
---

`runRepositoryContractTests` gains two narrow options so the shared invariant
table can be applied to `SysMetadataRepository` — the implementation that backs
every production metadata write, and the one that had never been handed to the
suite (#10420). Both are additive and optional; every existing call site is
unchanged.

- **`primaryType` / `secondaryType`** move the suite's two *fixture* metadata
  types (previously hard-coded `'view'` and `'object'`), defaulting to exactly
  those. This is a fixture knob, not an invariant knob: no clause is added,
  removed or weakened by moving it. It exists because an implementation may sit
  behind a write-authorization door keyed on the type —
  `SysMetadataRepository.assertAllowed()` refuses any type whose registry entry
  lacks `allowOrgOverride`, `'object'` included — so a hard-coded fixture type
  silently decided which implementations could be held to the table at all.
- **`declaredDivergences`** records an issue-tracked exception to the table.
  It does **not** skip the clause it names — a skipped clause is
  indistinguishable from coverage in a green run, which is the one failure a
  shared contract suite must not have. It swaps in a clause that *pins the
  divergent behaviour*, so the suite reds the day the implementation starts
  conforming and whoever fixes it is told to delete the declaration in the same
  PR. Shrink-only, audited in the fixing direction, like the repo's other
  ledgers. The only member today is `resumableWatch` (contract invariant 6), and
  the only declaration is `SysMetadataRepository` — see #10842.

Publishable behaviour is otherwise untouched: `packages/metadata-protocol` gains
a test file only, and 32 of the suite's 34 clauses were already satisfied by
`SysMetadataRepository` on the first run.
