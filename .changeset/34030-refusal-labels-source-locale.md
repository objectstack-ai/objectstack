---
'@objectstack/objectql': patch
'@objectstack/plugin-security': patch
---

fix(i18n)!: a refusal names fields, options and objects in the declared `sourceLocale` as authored

Clause-②: yes (narrowing) — `ValidationMessageContext.labelTranslation` is a new optional member (a widening), and `ValidationMessageContext.translate` no longer translates the labels a refusal names (a narrowing): a direct caller of `validateRecord`, `validateInsertValues` or `evaluateValidationRules` that passes `messages: { locale, objectName, translate }` now gets the declared labels until it also passes `labelTranslation`.
Metadata-protocol: none
Skills-docs: follow-up owed — skills/objectstack-i18n/SKILL.md, evals

<!-- adr-0087: not-required (runtime-interface-only packages/objectql/src/validation/record-validator.ts#ValidationMessageContext) the narrowed behaviour belongs to an input member of a runtime TypeScript interface, the messages option of the published validators; no packages/spec schema, registered node type, stored row or ADR-0087 conversion surface names it, and no key, value or default a metadata author can write changes, so there is nothing for objectstack migrate meta to rewrite -->

**BREAKING** for a TypeScript caller of `validateRecord`, `validateInsertValues` or `evaluateValidationRules` (`@objectstack/objectql`) that passes its own `messages`. Engine writes are not affected: the engine builds `labelTranslation` itself from the i18n service.

The labels a write refusal names are now resolved the way `GET /meta` serves them: `translateObject` over the deployment's translations, with the request's locale, the declared fallback chain and the authored language (`i18n.sourceLocale`, else `defaultLocale`). They are no longer looked up through `II18nService.t()`. Before this, an app authored in English that defaults its users to Chinese (`sourceLocale: 'en'`, `defaultLocale: 'zh-CN'`) answered an `en` request with the Chinese row in its validation, duplicate-record, delete-restricted and restore refusals, and in the security layer's master-detail and field-write `userMessage`. `/meta` answered the same request with the English label.

This covers a field label, a choice option label (field entry, then the shared picklist's), an object label, the master object named by the master-detail write gate and the fields named by the field-write gate. Message templates and authored rule messages still go through `t()`.

What follows from it:

- In the declared `sourceLocale`, a refusal names labels exactly as declared. In every other locale it follows the same chain `/meta` does.
- The labels come from `getLocales()` and `getTranslations()`. An i18n double that implements only `t()` no longer translates labels and leaves the declared ones in place, as `/meta` already did.
- On the in-memory i18n fallback (`@objectstack/core`), which reports no `getFallbackLocale()`, a request in a locale with no bundle now gets the declared label, as `/meta` does. Before, it got the default locale's row.
- A platform-injected system field (`owner_id`, `created_at`, …) that keeps its English default label is named by the built-in translation of that label, as `/meta` names it.
- The security layer's labels now negotiate the request locale the way `/meta` does, so a `zh-TW` request reads the `zh-CN` rows, in step with its `zh-CN` sentence.

## What a direct validator caller sees

| `messages` passed to `validateRecord` / `validateInsertValues` / `evaluateValidationRules` | was | now |
|:---|:---|:---|
| `{ locale, objectName, translate }` | field, option and object labels translated through `translate` | declared labels in every locale; `translate` renders message templates only |
| `{ locale, objectName, translate, labelTranslation }` | not a member of the type | labels translated through `labelTranslation`, the way `GET /meta` serves them |

What to do on upgrade: add `labelTranslation: () => ({ bundle, options })` to the `messages` you pass, where `bundle` is a `TranslationBundle` keyed by locale and `options` is a `ResolveOptions` (both from `@objectstack/spec/system`). The pair is typed `ValidationLabelTranslation`, now exported as a type from `@objectstack/objectql` and `@objectstack/objectql/core`. Nothing else changes: the call compiles as before, and no verdict, code or status moves.
