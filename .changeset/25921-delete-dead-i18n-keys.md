---
'@object-ui/i18n': patch
---

chore(i18n): delete 92 message keys nothing reads from all ten locale packs

Clause-②: no (only unused message keys go; no exported type or runtime contract changes)
Metadata-protocol: none

`ui/scripts/check-i18n-dead-keys.mjs` listed 122 keys with no call site and no textual occurrence anywhere in the repository. 92 of them are deleted from `ar`, `de`, `en`, `es`, `fr`, `ja`, `ko`, `pt`, `ru` and `zh`; no key is renamed or added, and no screen changes, because no code asked for any of them. The largest groups are `appDesigner.*` (20 keys), `report.*` (9), `publicForm.*` (8), `table.*` (7) and `layout.appSwitcher.*` (7).

Two groups the script also listed stay:

- 28 `_one` / `_other` plural forms (`preview.changes.typeCount.*`, `notifications.arrivalMany` / `arrivalRepeats`, `fields.relativeDate.overdue`). Their base keys are called with `count`, and i18next reads the plural form, so they are in use.
- `console.ai.agentLabels.dataChat` and `metadataAssistant`, which the pack keeps on purpose for external overrides.

A host that imports a pack object and reads one of the deleted members by property sees it gone from the type; nothing in this repository does.
