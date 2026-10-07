---
"@objectstack/spec": minor
"@objectstack/service-automation": patch
---

feat(spec)!: `NotifyConfigSchema.title` and `NotifyConfigSchema.message` are template slots: each takes a bare string or a `{ dialect: 'template', source }` envelope (the `tmpl` helper), as the expression dialect table already listed notification subjects and bodies among the `template` slots, and a blank bare string is now refused there

Clause-②: yes (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) No authorable key is renamed, retired or re-shaped for an author: `title` and `message` still take every non-blank bare string they took before, and now also the `template` envelope. The one newly refused input is a blank bare string (`''` or whitespace-only) at either key, and it was measured, not assumed. Census: the 31 files in this repo that author a `notify` node at the merge base (examples, docs, skills, the ADR, tests and fixtures) carry zero blank `title` / `message` values. The objectui pin (`a58626c8`) has 9 files that name a `notify` type and zero blank `title` / `message` literals. Not covered by either count: objectui's flow inspector deletes a cleared key only when the committed value is `''` (`setAtPath`), so a whitespace-only entry typed into the Studio form IS stored, and a stored flow carrying one is refused at its next run; hosted tenants' stored flows were not measured. No conversion can repair such a value, because an empty title or body has no intended text to recover: the remedy is authoring intent (write the text, or delete the key), so the ledger has nothing to rewrite. -->

**BREAKING** accept-set narrowing at two authorable keys (`automation/NotifyConfig:title`, `automation/NotifyConfig:message`), shipped as `minor` under the repo's launch-window convention for breaking changes. It is the grade `TemplateExpressionInputSchema`'s blank-string rule shipped with when it reached the first twelve typed keys.

- **What widens.** Both keys are typed with `TemplateExpressionInputSchema`, the input every other `template` slot uses. Before, both were `z.string()`, so a notify node written with `` tmpl`…` `` passed `defineFlow` and registration and then failed every run at the execute-time contract parse (`expected string, received object`). It now parses and runs.
- **What narrows.** A blank bare string (`''` or whitespace-only) at either key is newly refused, by the shared template input's non-blank rule (`invalid_union`, with the `TYPED_EXPRESSION_SOURCE_REQUIRED.template` sentence). Before, every blank value parsed:
  - `title: ''` then failed every run at the executor's guard ("notify: title is required"), so it fails either way, now earlier;
  - a whitespace-only `title` passed that guard and was delivered as the notification title, and it is now refused;
  - `message: ''` or a whitespace-only `message` was delivered as an empty or blank body, and it is now refused.

  The fix is to write the text, or to delete the key (`message` is optional).
- **Parse output.** `NotifyConfigSchema.parse(...).title` and `.message` go from `string` to `{ dialect: 'template', source }`, for both spellings, because the parse normalizes a bare string to that envelope. The exported `NotifyConfigParsed` type changes with them. Code that reads parse output reads `.source`. The `notify` executor, the one reader in this repo, now does, so both spellings of one text deliver the same `payload.title` and `payload.body`, and a bare string renders exactly what it rendered before.
- **Still refused, with a new sentence.** A value that is neither a string nor a template envelope (a number, an array, a `cel` envelope) was refused before (`invalid_type`). It is refused now as `invalid_union`, with the `TYPED_EXPRESSION_DIALECT_ONLY.template` sentence.
- **New, notify-only.** A template envelope on either key must carry a non-blank `source`. The executor renders `source` and has nothing to render from `ast` alone, so such an envelope is refused at the key instead of failing every run (`title`) or sending an empty body (`message`). An envelope never parsed at these keys before, so this refuses nothing that used to parse.
- **Placeholder spelling.** These two slots read the flow's single-brace `{token}` (`{record.name}`). A `{{var}}` is not a placeholder here: the inner `{var}` resolves and the outer braces stay in the text, for a bare string and an envelope alike. The `.describe()` on both keys now says so, and no longer says the text is "sent verbatim".
- `@objectstack/service-automation`: the `notify` executor reads `source` from the two template slots, and the descriptor's `title` / `message` descriptions state the `{token}` interpolation in place of "sent verbatim".
