---
'@objectstack/skills': patch
---

docs(skills): the i18n and ui skills teach the `mappings` translation group, an action's `texts` and where hook and action texts sit in a bundle; the stale label-serving caveat is gone

Clause-②: no
Metadata-protocol: none

- `objectstack-i18n`: the top-level group list names `mappings` (`mappings.{mapping}.label`, an import mapping's label by its `name`). The paragraph on keys picked in the organization's language now covers the sentences a hook or a `script` action declares in `texts` and writes through `ctx.text`: `hooks.{hook}.texts.{key}.message` and `_actions.{action_name}.texts.{key}.message`, also under `globalActions`.
- `objectstack-i18n`: the caveat that label serving reads inline text as `defaultLocale` text is removed, because serving honours `i18n.sourceLocale`. What is still true stays: validation and refusal messages read labels through `t()`, which falls back to `fallbackLocale`, else `defaultLocale`, so an English-source app with a zh-CN default still declares `fallbackLocale: 'en'`.
- `objectstack-ui` `rules/actions.md`: a `script` action declares a sentence it writes into a record under `texts` and asks for it with `ctx.text`. The rule covers the organization's language, a missing translation, an unreadable Localization setting and an undeclared key. The refusals paragraph points at the i18n skill for its bundle keys instead of spelling them.
- Evals: the i18n set gains a `mappings` case and a hook-texts bundle-key case, and case 11 states the remaining `t()` reason for `fallbackLocale: 'en'`. The ui set gains an action `texts` case.
