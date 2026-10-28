---
'@objectstack/skills': patch
---

docs(skills): the actions rule, its eval and the i18n skill teach an action's `disabledReason`

Clause-②: no
Metadata-protocol: none

- **Before.** `ActionSchema.disabledReason` (the display-only sentence a greyed action shows beside its `disabled` predicate) was on the protocol, but no published skill named it. An agent authoring an action from the skill left the console's default "Not available for this record" in place, or wrote the reason into `description`.
- **Now.** `objectstack-ui/rules/actions.md` has one bullet beside `disabled`: an I18nLabel, display-only, never a predicate or a gate; omitted keeps the console's default, a blank one is refused, and `disabledMessage` / `disabledTooltip` / `disabledHint` / `disabledText` are refused naming the key; the ReassignLead example carries it beside `disabled`. Eval 9 in `evals/views-apps-actions-pages.json` expects `disabledReason` beside a `disabled` predicate and forbids the reason in `description`; cases 5 and 8 are reworded so neither spells its own `must_not_contain` string. The `objectstack-i18n` group table lists `disabledReason` under `_actions.{action_name}` (and so under `globalActions.{action_name}`) beside `confirmText` / `successMessage`.
- No schema, key or behaviour changes.
