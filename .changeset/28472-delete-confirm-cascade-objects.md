---
'@object-ui/core': patch
'@object-ui/data-objectstack': patch
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(console): the row and record-page Delete confirmations name the objects a delete will cascade into, from the platform's served `cascadeDeleteObjects`

Clause-②: yes (widening)
Metadata-protocol: none

A delete can also delete child records, for example a lead's campaign memberships. The platform serves which objects, by name, beside the by-name object read (`cascadeDeleteObjects`). The Console now shows them:

- **The confirmation gains one line.** The row Delete, the selection's bulk Delete and the record page's Delete add one sentence naming those objects by their labels, in the user's language (new key `objectActions.deleteCascade`, in all ten built-in catalogs). An object the Console holds no label for reads by its name.
- **Nothing extra when nothing cascades.** A served empty list adds nothing. When the platform served no answer (an older backend, a draft read), the confirmation keeps today's text and says nothing about children. The Console never works the cascade out for itself.
- **How the list travels.** `@object-ui/data-objectstack` `getObjectSchema` keeps the envelope's `cascadeDeleteObjects` on the schema it returns, under a non-enumerable symbol, so a schema written back to a metadata endpoint never carries it. `@object-ui/core` exports `attachCascadeDeleteObjects`, `readCascadeDeleteObjects` and `CASCADE_DELETE_OBJECTS_KEY`, and `recordDelete.confirmCopy` takes an optional `cascadeLabels` list. `@object-ui/app-shell` `useObjectActions` takes an optional `objectLabelOf` and exports `resolveCascadeDeleteLabels`.
