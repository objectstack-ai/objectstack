---
"@objectstack/cli": minor
"@objectstack/lint": patch
---

`objectstack lint` now judges hooks authored as inline `handler` functions with the same write-set rules it already applied to explicit `body` hooks.

The `hook-body-write-unknown-field`, `hook-body-write-unprovisioned-anchor`, `hook-body-source-unparseable`, `hook-api-update-readonly-field` and `hook-api-update-readonly-when-field` rules open on `body.language === 'js'`. A hook written as `handler: async (ctx) => { … }` carries no `body`, so on the stack `objectstack lint` handed the rule registry the whole family returned before reading anything — while the reference app authors every one of its hooks that way. `objectstack build` never had the gap: it lowers each inline handler to a metadata body before it parses and judges the lowered stack.

`objectstack lint` now hands the registry's parsed-tier rules that same lowered view (the `lowerCallables` pass the build runs), so a handler-authored hook writing a `readonly` field through `ctx.api` is refused by the pre-flight exactly as the build would refuse it. What this does and does not change:

- A config whose inline handler writes a `readonly: true` field via `ctx.api.object(...).update()` / `.updateById()` / `.insert()` — and does not declare `runAs: 'system'` — now fails `objectstack lint` with `hook-api-update-readonly-field` (exit 1). It already failed `objectstack build` with the same finding, so nothing that built green fails lint red.
- The warning-severity members of the family (`hook-body-write-unknown-field`, `hook-api-update-readonly-when-field`, …) now report on inline handlers too; they never fail a run without `--strict`.
- Nothing about what `objectstack build` accepts changes, and `objectstack validate` — which parses without lowering — is unchanged and still does not see handler-authored hooks; both are recorded in the rules' headers.
- The lint input is never mutated: rules that read the live function value (`hook-body/not-lowerable` and its siblings) keep seeing it, and a handler the extractor refuses has no body on any command, so no rule guesses about a body that was not produced.

`@objectstack/lint` carries only the header ledger recording which commands reach each hook rule; its behaviour is unchanged.
