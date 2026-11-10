---
'@object-ui/plugin-chatbot': patch
'@object-ui/i18n': patch
---

feat(plugin-chatbot): the chat draws a confirm card for a package removal (`packageRemoval`)

Clause-②: yes (widening)
Metadata-protocol: none

When the assistant proposes deleting a package, the pending action's result carries a `packageRemoval` plan, and the chat now lists what goes before you decide: each object with its record count (a draft object says it has no table, and an object whose records could not be counted says so rather than showing 0), the other items by type, the total, a line when the total leaves out uncounted objects, and either a line that the tables are dropped permanently and do not go to the recycle bin, or a line that the tables and their records are kept. Approve and Deny stay the decision; after approval the card says whether the package was removed or only partly removed. `@object-ui/plugin-chatbot` exports `detectPackageRemoval` and the `PackageRemoval` / `PackageRemovalObject` types, `ChatbotEnhanced` takes the card's label props (`packageRemoval*Label`), and `@object-ui/i18n` adds the `console.ai.packageRemoval*` strings in every language pack. Nothing existing changes.
