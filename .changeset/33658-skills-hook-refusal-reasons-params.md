---
'@objectstack/skills': patch
---

docs(skills): the hooks and i18n skills teach a handler hook's `refusals`, a code's `reasons` and its `params`

Clause-②: no
Metadata-protocol: none

objectstack-data's `references/data-hooks.md` § Declared refusals no longer says only a `js` body can declare `refusals`: a `handler` hook (inline or named) can too, and only an `expression` body, or a hook with neither, is refused at save. Its example now declares a `reasons` entry (`on_loan`, thrown as `{ code, reason }`) and `params` (`due`, thrown as `params: { due }`), and the bullets say a `{{ name }}` hole is allowed only over a declared param, a reason missing from a code's `reasons` is refused like an undeclared code, and a reason's sentence is translated through `hooks.<hook>.refusals.<CODE>.reasons.<REASON>.message`. objectstack-i18n's SKILL.md names that key beside `hooks.<hook>.refusals.<CODE>.message`, and says a translation of a sentence with `params` keeps its holes. Four restatements in data-hooks.md were removed to pay for the new text.
