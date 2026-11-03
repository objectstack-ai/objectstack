---
'@object-ui/app-shell': patch
---

feat(app-shell): Studio's override mark opens a popover that names the customization and offers Restore package original

Clause-②: no
Metadata-protocol: none

In Studio, the mark on an item customized into the base's pair ("Overrides HotCRM") used to tell you nothing more, and you had to find "Restore package original" in the item's ⋯ menu. The mark is now a button. Pressing it opens a small popover that says which package the item overrides and which version of it the customization was taken from, with a "Restore package original" button. That button asks through the same confirmation dialog as before, and confirming sends the same two deletes at the pair: its draft, then its row. Customize keeps the header's primary slot, and Restore is never a header button of its own. The ⋯ menus of the Interfaces item, the flow and the All-metadata form editor no longer list Restore, so the mark is the one place to find it. On a narrow header, where the mark folds into the ⋯ menu, it opens the same popover there. Choosing the folded entry with the keyboard opens it too. The popover stays open while the pointer moves over it, and Restore there closes the ⋯ menu before the confirmation opens.
