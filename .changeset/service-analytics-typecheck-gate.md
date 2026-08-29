---
"@objectstack/service-analytics": patch
---

fix(service-analytics): wire the `typecheck` script so turbo stops silently no-opping the gate, and clear the 10 type errors it was hiding (#12939)

`packages/services/service-analytics/package.json` declared only `build` and
`test`. Root `typecheck` is `turbo run typecheck`, which **no-ops a package
that has no such script and reports success** — so no tsc read this package's
`src/` from the typecheck lane at all. `build` is tsup (esbuild; the DTS pass
processes declarations only) and `test` is vitest (esbuild transform), and
neither type-checks. The package was reached only by the `check:type-check-debt`
ratchet, which asserts the error count does not *grow* — never that it is zero.

Adding the one-line script (mirroring its sibling `service-settings`, repaired
the same way in #7925) makes the task real. The tests are already inside the
program — the package `tsconfig.json` includes `src` and the tests live in
`src/__tests__/**` — so `tsc --noEmit --listFiles` lists **83 of the 83**
`*.test.ts` files on disk. The new gate reads the tests, not just the source.

All 10 errors were stale tests, not source defects; no non-test source file
changed. Nothing was silenced: no `any` added, no `@ts-expect-error`, no
`@ts-nocheck`, `strict` untouched, and the tsconfig `include`/`exclude` are
byte-identical — excluding the tests would have converted a missing gate into
a lying one.

- `__tests__/measure-source-field-gate.test.ts` (7 x TS2339). `promise.catch(fn)`
  does not drop the resolved branch from the type, so
  `service.query(...).catch((e) => e as Error)` was `AnalyticsResult | Error`
  and every `err.message` / `err.field` / `err.member` / `err.param` read was a
  property access on `AnalyticsResult`. A local `refusalOf()` helper narrows it
  once via `then<never, Refusal>`; as a bonus the resolved branch now fails by
  name instead of surfacing later as `expect(undefined).toMatch(...)`.
- `__tests__/objectql-timedimension-projection.test.ts` (2 x TS7053). The
  `TABLE` fixture was inferred as `{ id: number; due_date: string; priority:
  string }[]` and the aggregate stand-in indexes it by a computed `string` key.
  Annotated as the `Row` (`Record<string, unknown>`) the file already declares.
- `__tests__/analytics-service.test.ts` (1 x TS6133). An unused
  `AnalyticsDriverCapabilities` type import. The capability literals in this
  file are inline `ctx` objects checked contextually at each `canHandle` call
  site, so the import added no coverage and is removed.

`service-analytics` graduates out of the `check:type-check-coverage` DEBT
ledger: 65/78 -> 66/78 workspace packages type-checked, 382 -> 372 frozen raw
errors, 13 -> 12 ledger entries.
