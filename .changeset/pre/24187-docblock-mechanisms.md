---
'@objectstack/spec': patch
---

Clause-②: no

The `ActionParam` `options` docblock in `src/ui/action.zod.ts` no longer quotes objectui's inline
param branch as `options: param.options`. At the console pin (`.objectui-sha` `5e15928b4631`) that
branch of `resolveActionParam` reads `options: authoredOptions`, where `authoredOptions` is
`resolveOptionLabels(param.options, ctx.locale)`: the authored array itself when every `label` is
already a string, and otherwise only the entries with an inline per-locale `label` re-spread with
that label resolved. The docblock's point is unchanged: an inline param's options, `visibleWhen`
included, reach the widget as authored. No key, schema, export, accepted value or message text
changes.
