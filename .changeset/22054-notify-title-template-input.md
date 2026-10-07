---
"@objectstack/spec": minor
"@objectstack/service-automation": patch
---

`NotifyConfigSchema.title` and `NotifyConfigSchema.message` are template slots: each takes a bare string or a `{ dialect: 'template', source }` envelope (the `tmpl` helper), as the expression dialect table already listed notification subjects and bodies among the `template` slots

Clause-②: yes (widening: a published notify slot now accepts the template envelope as well as the bare string)

- Both keys are typed with `TemplateExpressionInputSchema`, the input every other `template` slot uses. Before, both were `z.string()`, so a notify node written with `` tmpl`…` `` passed `defineFlow` and registration and then failed every run at the execute-time contract parse (`expected string, received object`).
- The parse normalizes a bare string to `{ dialect: 'template', source }`, so `NotifyConfigSchema.parse(...)` now returns the envelope for both spellings. The `notify` executor reads the envelope's `source` and interpolates it as before, so both spellings of one text deliver the same `payload.title` and `payload.body`. A bare string renders exactly what it rendered before.
- The placeholder spelling these two slots read is the flow's single-brace `{token}` (`{record.name}`). A `{{var}}` is not a placeholder here: the inner `{var}` resolves and the outer braces stay in the text, for a bare string and an envelope alike. The `.describe()` on both keys now says so, and no longer says the text is "sent verbatim".
- Still refused at each key: a value that is neither a string nor a template envelope (a number, an array, a `cel` envelope), and a blank bare string (`''` or whitespace), both by the shared template input. A blank `title` used to parse and then fail every run ("title is required"). A blank `message` used to send an empty body, the same as leaving `message` out.
- New, notify-only: a template envelope on either key must carry a non-blank `source`. The executor renders `source` and has nothing to render from `ast` alone, so such an envelope is refused at the key instead of failing every run (`title`) or sending an empty body (`message`).
- `@objectstack/service-automation`: the `notify` executor reads `source` from the two template slots, and the descriptor's `title` / `message` descriptions state the `{token}` interpolation in place of "sent verbatim".
