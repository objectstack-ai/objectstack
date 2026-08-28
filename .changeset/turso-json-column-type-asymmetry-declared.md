---
'@objectstack/driver-turso': patch
---

chore(driver-turso): declare and pin the `Field.json` column-type asymmetry between the local and remote transports (#12586)

`TursoDriver` is dual-transport, and one declared `Field.json` becomes a
different physical column on each. Local/replica mode extends `SqlDriver` and
lets knex spell it (`table.json(name)` — a `json` column); remote mode never
touches knex and spells its own SQLite types in
`RemoteTransport.mapFieldTypeToSQL` (`TEXT`). Nothing in the tree said whether
that was a design or an oversight — a grep found the two `mapFieldTypeToSQL`
lines and one passing comment — and no test would have gone red if either side
moved.

⛔ Nothing is broken and no behaviour changes here. Both transports round-trip
every `VALUE_ROUNDTRIP_CASES` value faithfully today and did before this PR.

**Why it is still worth recording.** Every column type in this driver is
spelled differently by the two halves — `varchar(255)`/`TEXT`,
`float`/`REAL`, `boolean`/`INTEGER` — and for all of those the difference is
cosmetic, because SQLite derives affinity from substrings of the declared type
name and both spellings land in the same class. `json` is the one that does
not: it matches none of SQLite's affinity markers, so it carries **NUMERIC**
affinity and converts number-like input on the way in, while `TEXT` converts
nothing. Measured on the shared fixture, that is not theoretical — a declared
`Field.json` holding the native `123` is an **INTEGER cell locally and a TEXT
cell remotely**, with `find()` answering `123` on both. Equal answers, unequal
bytes: the #11535 class in its quiet phase, where the next codec change has no
reason to be kind to both. PR #12585's ablation is the same fact in its loud
phase — the pre-#12380 `json` branch broke the two transports by *different*
counts, diverging on `s_0123`, because only the local column had NUMERIC
affinity to destroy a bare `'0123'` with.

**What lands:**

- The declaration, at the site a reader lands on when they ask why this returns
  `TEXT` — `RemoteTransport.mapFieldTypeToSQL`'s doc comment: the full
  local/remote type table, which rows are cosmetic and which one is not, the
  affinity mechanism as the "why it is safe today", and the instruction to
  delete or invert the pin rather than patch it green.
- The pin, `turso-json-column-type-asymmetry.test.ts`, driven by the same
  `VALUE_ROUNDTRIP_FIELDS` / `VALUE_ROUNDTRIP_CASES` table the round-trip
  conformance suite uses. It asserts each transport's declared types from the
  **catalog**, demonstrates the affinity mechanism with raw SQL that bypasses
  the driver codec, and asserts that the set of cases whose on-disk storage
  class differs is exactly `{n_int, n_real}` — so convergence (an empty set) is
  as red as one side drifting (a longer one).
- A note in `turso-value-roundtrip-conformance.test.ts` saying it is
  deliberately blind to this, since it is green either way.

⛔ Convergence (making both transports emit one type) is **not** done here.
It changes what new columns are physically declared as and needs the
un-measured "why did remote choose `TEXT`?" answered first; #12586 ruled it a
separate decision.

Grade: `patch`, argued rather than defaulted. Not `minor` — no new public API,
no widened accept set, no behaviour change, and the emitted DDL is byte-for-byte
what it was. Not `skip-changeset` either, though the only executable code this
PR ships is a test: what becomes a checked invariant here is a property of the
published package (which physical column a declared field gets on each
transport), and the CHANGELOG line is the record a future reader needs when
this guard goes red on them.
