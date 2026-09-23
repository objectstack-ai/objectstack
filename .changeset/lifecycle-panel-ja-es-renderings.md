---
'@objectstack/platform-objects': patch
---

Author the object form's data-lifecycle panel (ADR-0057) and the email-template
variables sample in `ja-JP` and `es-ES`.

Thirty-three `en` leaves — sixteen labels and sixteen helpTexts under
`object.fields.lifecycle.*`, plus `email_template.fields.variables.helpText` —
shipped their English source in both locales while `zh-CN` had all thirty-three
authored. An author working in Japanese or Spanish read the whole retention /
TTL / rotation / archive panel in English. Each leaf is now decided per locale
with its reason and the `en` source it was judged against, recorded in
`object-lifecycle-panel-echo-decisions.test.ts` and pinned to the live bundle,
to the `en` source and to the form declaration that manufactures it.

No keys are added or removed: values were authored by hand and the structure
regenerated with `pnpm i18n:extract`.

Clause-②: no
