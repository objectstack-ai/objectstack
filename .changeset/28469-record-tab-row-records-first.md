---
'@object-ui/plugin-detail': patch
---

feat(plugin-detail): the record page's tab row puts the related lists with records first, and the empty ones wait in the 「+N ▾」 dropdown

Clause-②: no
Metadata-protocol: none

The tab row under the record header used to place one tab per related list in the reader's arrangement, whatever its count, so on a record with many inbound lists two empty lists could take visible slots while lists with records sat in the dropdown. The right column already folds its empty panels into one line; the tab row now follows the same rule:

- **Lists with records first.** After Overview and Activity, the related lists whose count is not `0` keep the reader's arrangement among themselves, then the empty ones follow in the same order. A count that is not known yet (still loading, or a refused read) counts as non-empty, so that tab stays where the arrangement puts it.
- **Empty lists never take a slot.** Their tabs always sit in the dropdown, even on a row with room for them: after the tabs that did not fit, behind a separator, with their `0` in a muted face, and before the hidden lists' tabs.
- **The active tab stays on the row.** A link that opens an empty list (`?related=`) still shows its tab, in the row's last slot.
- **First paint is final.** The counts come with the record page's payload, so on a normal open the tabs do not move after the row first draws.
- **Nothing stored changes.** The order is computed when the row is drawn; the stored arrangement (`record.related.arrangement`) and its shape are untouched.

What to do: nothing. No metadata key and no setting.
