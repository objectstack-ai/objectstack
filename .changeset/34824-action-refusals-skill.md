---
'@objectstack/skills': patch
'@objectstack/spec': patch
---

docs(skills, spec): the ui and i18n skills teach an action's `refusals` catalogue and its translation keys; `action.zod.ts` gains a module description

Clause-②: no — skill teaching text, evals and two comment-only edits in packages/spec; no schema, export or accept set moves
Metadata-protocol: none — no metadata key is touched

objectstack-ui's `rules/actions.md` gains a short section, "Refusing by code (`refusals`)": a `type: 'script'` action with a `js` body declares the refusals it may throw and throws the code instead of a sentence, the catalogue, the throws and the checks are the ones a hook has (taught in objectstack-data's `references/data-hooks.md` § Declared refusals), the sentence is answered as `userMessage` and translated at `objects.<object>._actions.<action>.refusals.<CODE>.message`, and an authored `errorMessage` replaces it in the console's failure toast. The file's Add Line example now declares `refusals: { PRODUCT_NOT_FOUND: … }` and throws `{ code: 'PRODUCT_NOT_FOUND' }` where it threw `new Error('Product not found.')`.

objectstack-i18n's SKILL.md lists the keys in the object key table — `_actions.{action_name}.refusals.{CODE}` holds `message` and `reasons.{reason}.message`, the same under `globalActions.{action_name}`, and a key for a code or reason the action does not declare is `translation-target-unknown` — and the server-composed text section names an action's refusal beside a hook's. Each skill's eval file gains one case that grades the rule.

`@objectstack/spec`: comments only. `src/ui/action.zod.ts` opens with a module doc block, so the generated reference page and the two skill reference indexes describe the module ("Action protocol schemas — `ActionSchema`, the `action` metadata type, and the parts it is built from.") where they listed its first five exports, and the jsdoc above `actionRefusalsWithoutSandboxedBody` names the third case as the function judges it: a `script` action with no `body`.
