---
'@objectstack/plugin-audit': patch
---

Localize activity summaries to the workspace default locale (#3039). Activity
writers previously hardcoded English verbs and the object API name
(`Created person_qualification "OC-00001"`). The writer now resolves the
ADR-0053 `localization.locale` setting per write (memoized per tenant/user
scope), renders the verb through new `messages.activityCreated/Updated/Deleted`
i18n templates (en, zh-CN, ja-JP, es-ES shipped), and names the object by its
localized label (`objects.{name}.label`) with fallback to the authored def
label, then the API name. Missing i18n/settings services or bundle keys
degrade to the previous English summaries.
