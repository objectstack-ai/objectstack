---
"@objectstack/spec": minor
---

feat(spec): reject unknown keys on an action param instead of stripping them (#3405)

`ActionParamSchema` was zod-default `.strip`: any key it does not declare was
**discarded silently** and the param went on parsing. That is the mechanism
behind the `reference` bug — an author wrote a correct, clearly intended
`reference: 'sys_user'`, the key was eaten, and the param dialog rendered a text
box asking a human to paste a UUID. Adding `reference` fixed that one key; the
mechanism that swallowed it stayed, so the next mis-spelled key would fail the
same way, with the same zero feedback (ADR-0078 no-silently-inert-metadata,
ADR-0049 enforce-or-remove).

An action param is now `.strict()`. An undeclared key is a parse error naming the
offending key, and — when the key is a recognisable spelling of a declared one —
the canonical key to use instead:

```
Unrecognized key(s) on this action param: `reference_to`. Did you mean
`reference_to` → `reference`? Until #3405 these were dropped silently — the param
still parsed, so a mis-spelled config shipped as a control that quietly ignored
it.
```

**Migration.** A param that previously carried an extra key now fails to parse.
The fix is to correct or remove that key; the error names it. Common mappings —
case/underscore slips are matched automatically, these are the ones that need a
different word:

| Wrote | Use |
|---|---|
| `reference_to` / `referenceTo` / `targetObject` | `reference` |
| `visibleWhen` / `visibleOn` / `visibility` | `visible` |
| `description` / `help` | `helpText` |
| `default` | `defaultValue` |

Declared keys are unchanged: `name`, `field`, `objectOverride`, `label`, `type`,
`required`, `options`, `placeholder`, `helpText`, `defaultValue`, `multiple`,
`accept`, `maxSize`, `reference`, `defaultFromRow`, `visible`, `requiresFeature`.
