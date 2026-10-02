---
'@objectstack/cli': minor
---

fix(cli)!: `os verify` runs the author-time rules first, and a stack they refuse fails `verify` with the findings `os validate` reports (#21323)

Clause-②: yes (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) a CLI command's verdict, not a declaration: os verify now refuses, before it boots anything, a stack the author-time rule registry refuses or that does not parse against the protocol schema. No authorable key, spelling, export or stored shape moves: every stack parses and loads exactly as before, os validate and os build answer exactly as before, and nothing on the metadata load path is read or rewritten. What an author does about a refusal is fix the finding the message names, which os validate and os build already report for the same stack, so there is no rewrite a ledger entry could carry. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id covers a command's verdict (not registered / already-registered); and the change is CLI behaviour, not a TypeScript declaration (not runtime-interface-only / type-surface-only). -->

**BREAKING** — `os verify` narrows what it passes. It ships as `minor` under the launch-window convention for accept-set narrowings.

**What was accepted before.** `os verify` booted the app and exercised CRUD round-trip fidelity and, with `--rls`, the RLS invariant — and nothing else. A stack carrying a lookup to an object that does not exist, an action `visible` expression naming a field without `record.`, or a list column naming no field booted, round-tripped its records and printed `✓ verify passed` at exit 0, while `os validate`, `os build` and `os lint` all refused it. The documented done-bar ("`objectstack verify` is green") was green on a stack the build refuses to ship.

**What is refused now.** `os verify` runs two stages. The first is the author-time rule registry `os validate` runs, over the stack prepared the way `os validate` prepares it: normalized, inline handlers lowered, parsed against the protocol schema, the SDUI manifest read beside the config, judged whole and then once per package of a multi-package artifact. A gating finding, or a stack that does not parse, exits 1 with those findings and the runtime stage never starts:

- text face: `✗ Author-time rules failed (N issues) — the runtime stage did not run`, then each finding with its rule and location (the per-package and schema refusals have their own sentence);
- `--json`: the command's failure envelope, `error` (the sentence), plus a new key, `errors`, carrying the findings in the shape `os validate --json` carries them under `errors` — rule findings (with `package` on a per-package one), or the schema issues.

Advisories never fail the stage; the text face counts them and points at `os validate`. On a passing stack the text face prints one step line and `✓ Author-time rules passed (N rules)` before the runtime stage, and the `--json` report of a run that reaches the runtime stage is unchanged.

**Who is affected.** Only a stack `os build` already refuses: the first stage runs the same gating rules over the same prepared stack, so every stack it refuses, `os build` refuses too. The remedy is the one `os validate` prints for each finding. Measured with this branch's CLI over the examples at `222ecc27f9` (unchanged on this branch): `os validate` exits 0 on `examples/app-todo`, `examples/app-crm`, `examples/app-showcase` and `examples/app-multi-package`, so none of the four is refused by the new stage.
