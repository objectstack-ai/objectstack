---
'@object-ui/plugin-form': patch
---

fix(plugin-form): the modal and drawer record forms save the package of a permission-set holder the user picked on a New form

Clause-②: no
Metadata-protocol: none

Where two packages provide one permission-set name, a permission-set grant's New form lets the user pick which package's set to grant, and saves that package beside the name. The full-page, tabbed and wizard forms already did. The modal and drawer forms showed the pick and then saved the name alone, so the server read the grant without the package the user chose. They now save it under exactly the same conditions as the other forms: on a New form only, for the grant object only, and only when the user changed it from what the form opened with. The server still judges every write.

A name one provider serves, an edit form, and every other object's form are unchanged. No export and no translated string is added.
