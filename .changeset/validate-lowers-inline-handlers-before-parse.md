---
"@objectstack/cli": minor
"@objectstack/lint": minor
---

`objectstack validate` now lowers hooks authored as inline `handler` functions to a metadata body before it parses, so the hook write-set rules judge them there exactly as `objectstack build` and `objectstack lint` already do.

The `hook-body-write-unknown-field`, `hook-body-write-unprovisioned-anchor`, `hook-body-source-unparseable`, `hook-api-update-readonly-field` and `hook-api-update-readonly-when-field` rules open on `body.language === 'js'`. A hook written as `handler: async (ctx) => { … }` carries no `body`, and `objectstack validate` parsed the normalized stack without lowering — so on that command the whole family returned before reading anything, and a stack `objectstack build` refuses with `hook-api-update-readonly-field` (exit 1) passed `objectstack validate` with exit 0 and no finding. The same statement authored as an explicit `body: { language: 'js', source }` was refused by `objectstack validate` all along, so the silence was the command's intake, not the rule.

`objectstack validate` now runs the same `lowerCallables` pass `objectstack build` runs before its parse — after its two pre-parse undeclared-key lints, which keep reading the un-lowered stack, and before the schema parse, which reads the lowered view — and hands the rule registry the parsed result as before. What this does and does not change:

- A config whose inline handler writes a `readonly: true` field via `ctx.api.object(...).update()` / `.updateById()` / `.insert()` — and does not declare `runAs: 'system'` — now fails `objectstack validate` with `hook-api-update-readonly-field` (exit 1). It already failed `objectstack build` and (since #16095) `objectstack lint` with the same finding, so nothing that builds green starts failing `objectstack validate`.
- The warning-severity members of the family now report on inline handlers under `objectstack validate` too; they fail a run only with `--strict`, as every other advisory does.
- The `--json` payload gains no key and the text face prints no new step: the lowering is a view for the parse and the rule registry. A handler the extractor cannot lower (a forbidden token, a module-scope identifier) has no body on any command and is reported by `objectstack lint`'s `hook-body/*` rules and `objectstack build`'s warn-and-bundle line, never guessed at here.
- Nothing about what `objectstack build` accepts changes.

Measured on this repository's ten `objectstack.config.ts` corpus files at `6ba0db4e0` with `objectstack validate --json`, before and after: **exit code, error text and rule-id list identical on 10 of 10 — zero findings change, zero verdicts change.** Six reach the rule registry (the four example apps and the `plugin-auth` / `plugin-security` / `service-i18n` configs); two (`driver-memory`, `plugin-hono-server`) are plugin manifests, not stacks, and are refused at the schema parse — after the lowering point — with the same top-level `unrecognized_keys` on both sides; two (`app-showcase`, the `blank` template) fail at load in the measuring environment, before the lowering point, on both sides. None of the repository's handler-authored hooks writes through `ctx.api`, which is why the delta is zero rather than the family being unreached; the reach itself is pinned by the card's own fixture, with the body-authored control beside it and a handler-authored hook the family has nothing to say about still passing.

`@objectstack/lint` carries only the header ledger recording which intakes reach each hook rule; `objectstack validate` moves from "not reached" to "reached". Its behaviour is unchanged.
