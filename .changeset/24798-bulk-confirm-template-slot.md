---
'@objectstack/spec': minor
'@objectstack/lint': minor
'@objectstack/cli': minor
---

feat(spec,lint): a bulk action's `confirmText` is a `template` slot over `count` and the action's params

Clause-②: yes (widening)
Metadata-protocol: semantic

- **Before.** `bulkActionDefs[].confirmText` was a plain `z.string()` that declared no hole. A sentence such as `'Update tier on {{count}} account(s) to {{tier}}?'` parsed, nothing judged its holes, and the console showed them as literal text.
- **Now.** `confirmText` is an ADR-0032 `template` slot (Decisions 2–3). A bare string is shorthand for `{ dialect: 'template', source }`, and the envelope form is accepted too. Holes are `{{ path }}` and `{{ path | formatter[:arg] }}`, with formatters from the template engine's whitelist and no logic inside a hole. They read a closed scope, and `bulkConfirmTemplateRoots(def)` (`@objectstack/spec/ui`) declares its roots: `count` (`BULK_CONFIRM_COUNT_ROOT`, the number of records the run covers) and each of the def's params by `name`. The roots are written bare: `{{ tier }}`, never `{{ params.tier }}`. That matches how the flow text slots spell their roots and how shipped sentences already spell them, and `count` wins over a param of that name. A param hole renders the param's display value: the chosen option's `label` (labels joined with `', '` for a multi-value param), the picked record's display name for a lookup or user param, and the entered value otherwise, so number, date and currency values take a formatter.
- **Parsed shape.** A parsed `confirmText` is now the `{ dialect: 'template', source }` envelope rather than a string, as `titleFormat` and a notify node's `title` already are. A reader of the parsed or served def takes the text from `source` (`templateSlotSource` in `@objectstack/spec/automation` reads both forms). A stored sentence with no hole parses as before, its text unchanged.
- **Judged by the one template judge.** `objectstack validate`, `objectstack compile` and the runtime publish gate (now also on `view` writes, and on an object's own `listViews` at an object write) judge each bulk `confirmText` through `closedScopeTemplateRefusal`. That is the closed-scope entry of the judge the flow text slots use (`automation/flow-text-slot-template.ts`). A hole over an unbound root and a single-brace `{x}` token are named, the latter with its `{{ }}` spelling. A text carrying neither is then compiled as a template, which names a hole holding logic or an unknown formatter.
- **A warning, not a refusal.** Each of those texts parsed while `confirmText` was a plain string, so refusing it is a narrowing that no ADR-0087 conversion carries. This release ships every finding above as a **warning**: an advisory at the publish gate, never a refusal, so no command's exit code changes. A blank `confirmText` (`''`) still parses, and the doors warn on it.
- **`os i18n extract`.** A bulk `confirmText` written as the envelope is seeded exactly as the bare string: the extractor reads the slot's text through `templateSlotSource`, so the envelope form no longer records as an absent key with nothing to translate.
- **Served translations.** The catalog overlay on a served view or an object's `listViews` compares a bulk `confirmText` with its packaged base by the slot's text, whichever form either side holds: an unchanged envelope still takes the catalog's sentence, and an edited one keeps the authored sentence.
- **Unchanged.** The `confirm` / `confirmmessage` near-misses still name `confirmText`. Every other bulk-def key, the default confirm sentence and the flow text slots' verdicts are unchanged.
