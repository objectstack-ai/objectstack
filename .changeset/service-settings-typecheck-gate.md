---
"@objectstack/service-settings": patch
---

fix(service-settings): wire the `typecheck` script so turbo stops silently no-opping the gate, and clear the 14 type errors it was hiding (#7925)

`packages/services/service-settings/package.json` declared only `build` and
`test`. `turbo run typecheck --filter=@objectstack/service-settings` therefore
exited **0 while never running a typecheck task at all** — turbo no-ops a
package that has no such script, and reports success. "typecheck green" for
this package was a claim nothing enforced.

Adding the one-line script (mirroring its sibling `service-messaging`) makes
the CI-equivalent command execute a real `service-settings:typecheck` task —
7 tasks where there were 6 — and it immediately surfaced 14 pre-existing
errors across five test files. Every one was a **stale test**, not a defect in
the source; no `service-settings/src/*.ts` non-test file changed.

- `sms.manifest.test.ts` (3), `storage.manifest.test.ts` (4), and
  `ai.manifest.test.ts` (5, previously behind `as any`) invoked their action
  handlers with a partial input. `SettingsActionHandler` takes
  `{ namespace, actionId, values, payload?, ctx }` and the service always
  passes all of it (`settings-service.ts:1809`); the tests had drifted to the
  older two-field shape. They now call handlers the way the service does — and
  the `as any` casts that were hiding the same drift in the `ai` tests are
  gone rather than extended to the other two files.
- `settings-service.test.ts` passed `record: (e) => events.push(e)` for an
  audit sink declared `Promise<void> | void`; the expression-bodied arrow
  returned `Array.push`'s number.
- `settings-translation-coverage.test.ts` filtered the manifests barrel
  through a hand-rolled structural `Manifest` type that had drifted from the
  real one (`label` is `string | Record<string, string>`, not `string`),
  making its type predicate unassignable to the exports it narrowed. It now
  narrows to the spec's own `SettingsManifest`.

`aiTestEmbedderActionHandler` was imported by `ai.manifest.test.ts` and never
used — the unused import the compiler flagged. Rather than delete the import,
the two cases it was there for are now tested: the manifest declares a
`test_embedder` action button whose handler had no coverage.

No error was silenced: no `any` was added, no `@ts-expect-error`, and the
package tsconfig's `include` is unchanged (its tests live under `src`, so they
were always inside the program — only the script that reads them was missing).

The package's entry in the `check:type-check-coverage` DEBT ledger is deleted,
since it graduated: the gate goes from 63/77 workspace packages type-checked to
64/77, and the frozen raw-error total from 455 to 442.
