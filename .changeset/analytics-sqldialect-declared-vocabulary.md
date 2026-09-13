---
"@objectstack/service-analytics": minor
---

fix(analytics)!: `AnalyticsServiceConfig.sqlDialect` declares its three-name accept set, and a host that answers outside it is told once (#16206)

<!-- adr-0087: not-required (runtime-interface-only packages/services/service-analytics/src/analytics-service.ts#AnalyticsServiceConfig) The narrowed member is one hook on a service CONSTRUCTOR CONFIG — a published runtime TypeScript interface with no metadata surface. It has no Zod schema, no `packages/spec` declaration and no stored representation, so `objectstack migrate meta`, `spec-changes.json` and the generated upgrade guide have nothing to rewrite; the affected party is a TypeScript host and the channel that reaches every one of them is the compiler at their own composition site. No metadata key is added, removed, renamed or re-shaped, and `packages/spec` is untouched by this diff. -->

**BREAKING** for a TypeScript host that declares its `sqlDialect` hook as returning
`string`: the hook's declared return is now the three canonical dialect names or
`undefined`, so such a composition stops compiling until the host's own annotation
says which names it can answer. Shipped as `minor` under the repo's launch-window
convention, in which breaking-ness is carried by this banner and the disposition
above rather than by the bump level. Runtime behaviour for every host is unchanged:
the same three names were the only ones that ever did anything.

## What was wrong

`AnalyticsServiceConfig.sqlDialect` — the hook a host answers to say which SQL
dialect backs an object — was typed as free `string`, while `normalizeSqlDialect`
has only ever recognised `sqlite`, `postgres` and `mysql`. Nothing said so, and
nothing told a host that answered otherwise.

So a host that owns a SQLite datasource and answers the spelling its own stack uses
— knex's canonical `sqlite3`, or `better-sqlite3`, both of which `driver-sql` itself
lists in `SQLITE_EMIT_CLIENTS` — was read as `unknown`. And because `sqlDialectFor`
is tiered "cannot answer, do not block", **a wrong answer and no answer were the
same answer**: the host that tried hardest to help got the residue arm, silently.

## What it does now

- **The vocabulary is declared**, on the type and in the docblock, as
  `AcceptedSqlDialect` — `sqlite` | `postgres` | `mysql` — so a host reading the
  config learns the accept set without running anything. The type and the runtime
  membership set are generated from one `const` tuple, so a future widening cannot
  land in one and miss the other.
- **A non-empty answer outside the set is diagnosed**: one `warn` naming the object,
  the answer and the accepted set. It is emitted **once per distinct unrecognised
  spelling** — the failure's identity — so the line count is bounded by the host's
  own hook and never grows with query volume.
- **`undefined` stays silent and legal.** The hook is optional and "cannot answer,
  do not block" is a supported composition, not a misconfiguration. A pin holds both
  halves, because a diagnostic that also shouted at hosts who wired nothing would be
  a worse defect than the one being fixed.
- **The accept set is NOT widened.** Teaching this package `driver-sql`'s knex
  aliases would be a second copy of that driver's table, and an unrecognised
  spelling is sometimes deliberate (`mariadb`, #11756). The answer is still read as
  `unknown`; only the silence changed.
- **The plugin bridge translates the driver's own residue.** `SqlDriver.dialectName`
  carries a fourth name, `unknown`, meaning "I cannot say"; handed on verbatim it
  would have presented a correctly-behaving driver as a host answering out of
  contract. It now arrives as `undefined`, this hook's own spelling for the same
  thing. The dialect the compilers end up with is unchanged either way.

## Measured, and worth reading before relying on the residue arm

Driven on sql.js through a host answering `sqlite3`, against the shared
`FILTER_TEXT_CASES` fixture, with a host answering `sqlite` as the control: **five of
the six case-EXACT cases come back with the wrong rows** — every case that
discriminates on ASCII case. `{ name: { $contains: 'acme' } }` answers `['1','2']`
where the table says `['2']`, and the negated form DROPS a row that belongs in the
result. That is #15684's fold, live on the arm this population lands on, and it is
reported rather than fixed here: closing it is that card's business, not this one's.
