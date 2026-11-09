---
'@objectstack/plugin-sharing': patch
---

i18n(plugin-sharing): the assignment rule object ships in all eleven platform languages

Clause-②: no
Metadata-protocol: none

`sys_assignment_rule`, the object an organization authors its own assignment rules in, now carries its label, description, field labels and help, option labels and its "By Object" view name in `zh-CN`, `ja-JP`, `es-ES`, `zh-Hant`, `ar`, `fr`, `pt-BR`, `ru`, `de` and `ko`, so an administrator in any platform language reads Setup → Assignment Rules in their own language instead of English. The object is now listed in the package's extract config, so the existing `check:i18n` bundle check covers it. Its recipient options read the same words as the queue and sharing objects in each language. Part of #30512.
