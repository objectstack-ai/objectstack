---
'@objectstack/spec': minor
'@objectstack/core': minor
'@objectstack/runtime': minor
'@objectstack/lint': minor
'@objectstack/service-automation': patch
---

feat(hooks): a hook writes the sentences it declares in the organization's language

Clause-②: yes (widening) — a hook may now declare `texts` and its code may call `ctx.text`; translation bundles accept `hooks.<hook>.texts.<key>.message`; `@objectstack/core` exports `readOrganizationTextLocale`. Nothing that was accepted before is refused
Metadata-protocol: added
Skills-docs: follow-up #34546

A hook can now declare the sentences it writes into records for people to read, and ask for one by key: `texts: { follow_up_subject: { message: 'Follow up with qualified lead: {{ lead }}', params: ['lead'] } }`, then `await ctx.text('follow_up_subject', { lead })`. The answer is in the organization's language, because everyone in the organization reads the record: the Localization setting (`localization.locale`) when somebody set it, else the app's declared `i18n.defaultLocale`. It is never the language of the person whose save fired the hook. The translation `hooks.<hook>.texts.<key>.message` is picked first, then its `{{ }}` holes are filled from `params`.

- A missing translation, or no language to pick, answers the declared sentence, and the hook goes on.
- A Localization setting that cannot be read rejects the call, so another language is never stored over a choice that may exist. A host that registers no `localization` setting has none set, so the app's declared default answers.
- Only declared text is translated: a string the hook builds itself is written as it is. A key `texts` does not declare is refused when the hook is saved if the hook asks for it literally (`ctx.text('key')`), otherwise when the hook runs, as a fault naming the hook and the key. `texts` on an `expression` body, or on a hook with neither a body nor a handler, is refused. A text with no `params` is plain text, and a `{{ }}` hole in it is refused.
- `ctx.text` is the same on a sandboxed `js` body and on an in-process `handler`.
- `os i18n extract` scaffolds the key, and the existing coverage check counts it. `objectstack validate` refuses a `hooks.<hook>.texts.<key>` translation over a key the hook does not declare.
- Text is picked when it is written. Records already written are not changed.

`@objectstack/core` exports `readOrganizationTextLocale`: the one reading of the organization's language that every writer of such text shares, with an unregistered Localization setting answered as not set. The flow record write (`@objectstack/service-automation`) now reads through it; its answers are unchanged.
