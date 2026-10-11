---
"@objectstack/cli": minor
---

fix(cli)!: `objectstack build --strict-body` counts each callable once, and `--json` `issues` lists callables only (#22839)

Clause-②: no (narrowing)

`--strict-body` printed "N callable(s) lack a metadata body" with N one higher than the callables it listed: one refused handler read 2, four read 5. The list was the extractor's refusals plus one extra row whenever any callable was not lowered, with `origin: '<aggregate>'` and the reason "N callable(s) lowered to handler ref but produced no body". The header counted that extra row as a callable, and `--json` published it in `issues` beside the real ones.

The list is now one row per callable that was not lowered into a metadata body, each callable once. It is the same population the extra row counted, itemized. The header's N is the number of rows.

**BREAKING — what moves for consumers.**

- **`--json` `issues`, on the `strict-body: missing body` exit.** Before: the refusals plus the `<aggregate>` row. Now: callables only, and no row has the origin `<aggregate>`. A handler the extractor refused keeps its row unchanged (`origin`, `reason`, `kind`, `freeIdentifiers`). A callable that was never tried now gets its own `{ origin, reason }` row instead of being folded into the aggregate's number: a top-level `functions` entry (`function 'name'`, which has no `body` slot), or a hook or action whose author wrote its own `body` beside an inline function (that function still rides the runtime module).
- **The header.** It reads the number of rows listed. For one refused handler that is 1, not 2.
- **A stack that carries the same callable at the top level and inside a `packages[i].manifest` body.** Such a stack is walked twice, so a refusal was listed twice and a lowered body was counted twice. Each callable is now listed once. A `functions` entry in such a stack beside a lowered hook was hidden by the double count, so the build passed `--strict-body`; it is now refused, and named.
- **A stack that binds one function as the handler of two or more hooks or actions, beside a `functions` entry or a hook or action with an authored `body`.** This happens in a single walk too. The shared function was lowered at each of its slots, and each slot counted as one lowered body, while the function counted as one callable. The surplus cancelled the callable beside it that was never lowered, so the old count read 0, no warning was recorded, and the build passed `--strict-body`. Such a stack is now refused, and the row names the `functions` entry, or the hook or action whose author wrote its `body`.

**The one-line fix**, for a script that read the `<aggregate>` row: read `issues.length` for the number of callables, and the rows themselves for which ones.

**Unchanged.** For a stack in which each callable is bound at one slot, `--strict-body` refuses exactly the stacks it refused before. Every refusal keeps the same exit code (1) and the same `error` string. The default build (no `--strict-body`), its warning lines, `bodyExtractionWarnings` in the success payload and the runtime-bundle decision do not move. No spec key, export, type or stored shape moves.

<!-- adr-0087: not-required (no-migration-prescription) a CLI diagnostic payload narrows: `--strict-body`'s `--json` `issues` stops carrying a placeholder row that named no callable, and the header's count drops by that row. No authorable key, spelling, export or stored shape moves, and no stored row is read, rewritten or converted, so there is nothing for `objectstack migrate meta` to derive. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id covers this output (not already-registered); and it is a build diagnostic, not a runtime TS interface or a type surface (not runtime-interface-only or type-surface-only). -->
