---
'@objectstack/skills': patch
---

docs(skills): objectstack-i18n teaches the action `preflight.fields.{path}` translation key

Clause-②: no
Metadata-protocol: none

- `skills/objectstack-i18n/SKILL.md`'s `_actions.{action_name}` row names `preflight.fields.{path}`: only under an action that declares `preflight`, keyed by a field's literal `path` in its `preflight.fields[]`, its value a plain string; any other key under `preflight` (a `title`, for example) is refused when the bundle is parsed.
- The `translation-target-unknown` paragraph adds a `preflight.fields` path the action does not declare, including under an action with no `preflight`.
- Nothing to do on upgrade: the key is already accepted, checked and read by the console; this only teaches it.
