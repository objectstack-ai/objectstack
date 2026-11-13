---
'@object-ui/fields': patch
'@object-ui/plugin-form': patch
---

fix(plugin-form): the modal and drawer record forms save the package of a permission-set holder the user picked on a New form

Clause-②: no
Metadata-protocol: none

Where two packages provide one permission-set name, a permission-set grant's New form lets the user pick which package's set to grant, and saves that package beside the name. The full-page, tabbed and wizard forms already did. The modal and drawer forms showed the pick and then saved the name alone, so the server read the grant without the package the user chose. They now save it under exactly the same conditions as the other forms: on a New form only, for the grant object only, and only when the user changed it from what the form opened with. The server still judges every write.

A package picked on an open New form now stays with the name it was picked for. If the app re-fills the open form with another permission set (a new prefill while the form stays open), the form used to keep the earlier package beside the new name: it showed that package as the new name's holder and saved the two together, so the grant could go to a package the user never chose for that name. Now, while the permission-set field is on screen, the package is cleared when the name changes any way other than the user's own pick, so the form shows the new name as the server will read it and saves the name alone. This applies to the full-page, tabbed, modal and drawer forms. The wizard form ignores a re-fill, as before, and closing and reopening a form already started clean. One case is not covered: if the section that holds the permission-set field is hidden while the form is re-filled and then shown again, the form keeps the earlier package beside the new name.

A name one provider serves, an edit form, and every other object's form are unchanged. No export and no translated string is added.
