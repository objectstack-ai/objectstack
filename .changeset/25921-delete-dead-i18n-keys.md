---
'@object-ui/i18n': patch
---

chore(i18n): delete 92 message keys nothing reads from all ten locale packs

Clause-②: yes (TranslationKeys narrows by 92 unread members; patch per the #4730 retirement precedent)
Metadata-protocol: none

`ui/scripts/check-i18n-dead-keys.mjs` listed 122 keys with no call site and no textual occurrence anywhere in the repository. 92 of them are deleted from `ar`, `de`, `en`, `es`, `fr`, `ja`, `ko`, `pt`, `ru` and `zh`; no key is renamed or added, and no screen changes, because no code asked for any of them. The largest groups are `appDesigner.*` (20 keys), `report.*` (9), `publicForm.*` (8), `table.*` (7) and `layout.appSwitcher.*` (7).

Two groups the script also listed stay:

- 28 `_one` / `_other` plural forms (`preview.changes.typeCount.*`, `notifications.arrivalMany` / `arrivalRepeats`, `fields.relativeDate.overdue`). Their base keys are called with `count`, and i18next reads the plural form, so they are in use.
- `console.ai.agentLabels.dataChat` and `metadataAssistant`, which the pack keeps on purpose for external overrides.

`TranslationKeys` (`typeof en`) and the other pack objects' types lose the 92 members. A host that reads one of them by property gets a type error; nothing in this repository does, and no `t()` call anywhere asks for one.
