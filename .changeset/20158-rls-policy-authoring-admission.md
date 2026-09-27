---
'@objectstack/lint': minor
'@objectstack/metadata-protocol': minor
'@objectstack/cli': minor
---

RLS policies are admitted when they are authored: the engine judges every read-scope `using`, at the save door and at `os validate` / `os build` / `os lint`

A row-level-security policy (`rowLevelSecurity[]` on a permission set) could carry a `using` predicate that lowers cleanly and that the engine then refuses to run: a text operator (`startsWith` / `endsWith` / `contains`) aimed at a number field, a date field compared against a value its storage cannot read, a filter on a virtual (formula) field, or a `{…}` placeholder string. Nothing refused it when it was written. The first answer was a refused analytics query, long after the author had moved on. And the metadata save door (Studio, REST `/meta`, MCP) did not run the RLS predicate rule at all, so a predicate `os validate` already refused was accepted there.

- **The engine's own verdict.** `validateRlsPredicateEnforceability` takes the engine's judge-only filter admission (`IObjectQLEngine.judgeFilter`) as an optional input and judges the lowered `using` of every `select` / `all` policy with it. A refusal is reported under the existing id `rls-predicate-unenforceable`, and the message quotes the engine's code, status and sentence verbatim. The rule never models the engine's checks: without the input it answers exactly as before.
- **Both doors hand in a real engine.** The metadata save door probes its host engine for `judgeFilter` and passes the bound method through the publish gate. The CLI commands build an engine with no driver from the stack's own objects and pass its method.
- **The save door now runs the rule for `permission` writes** (`surfaces: ['cli', 'runtime-publish']`, `runtimeTypes: ['permission']`), so every predicate `os validate` refuses is refused there too, as a `422 INVALID_METADATA` whose `issues[]` carries the same sentence.
- **New optional inputs.** `AuthoringRuleContext.judgeFilter` (and so `AuthoringRuleRun.judgeFilter` for `runAuthoringRules`), the `judgeFilter` argument of `runRuntimeAuthoringRules`, and an optional second parameter of `validateRlsPredicateEnforceability`. A caller that passes nothing gets the previous verdicts.

**BREAKING**: a permission set whose read-scope `using` the engine cannot run now fails `os validate` / `os build` / `os lint`, and a publish of it through the metadata save door is refused with `422`. Stored rows keep being read, and a re-save of one is judged like any other publish. `OS_ALLOW_UNLINTED_METADATA_WRITES=1` still turns the save-door refusal into a logged warning for a migration window. The refusal's hint names the fix for each class: write the caller's value as a `current_user` key rather than a `{…}` placeholder, point a text operator at a field that holds a string, compare a date field against a value its storage reads, or denormalise a computed value onto a stored field. Every policy authored in this repository, in its examples and in the default permission sets was measured, and none is refused.

Two edges are not closed here, both deliberately:

- The judge sees only `using` clauses in the read scope. A `check` is matched in memory against the post-image and never reaches the engine's filter admission.
- At the save door, the judge reads the engine's live registry. An object that exists only in the same publish batch, or only in an organization overlay, is one that registry does not hold, so it gets the engine's unknown-object answer: no field-type verdict, while the placeholder and comparand checks still run. At the CLI door, an object the stack does not define gets the same answer.

Clause-②: yes (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) Nothing an author writes moves: no `packages/spec` key, schema, export or config field is removed or renamed, and no stored metadata representation changes, so `objectstack migrate meta` has nothing to rewrite. What is refused is a predicate VALUE the engine's own filter admission already refuses whenever it is asked to run it; the refusal now arrives when the policy is authored. The new lint inputs are optional additions. -->
