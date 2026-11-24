---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

fix(studio): Customize is offered only on a list view the read-only base ships

Clause-②: yes (widening)
Metadata-protocol: none

On a read-only base, an object's page in Studio lists every list view of the object, including views created in the app (the console's New view) and views the customization package adds. Customize declares an override of the base's view, and the server refuses that declaration for a view the base does not ship, so the first saved edit of such a view answered 403 ("declares an override of …, which ships no view named …"). Studio now reads whether the base ships the view from the layered read at the base (its code layer) and offers Customize only then. A view created in the app is read-only in Studio, and its panel says it is edited in the app, from Manage views › Edit view config; a view the base serves nothing of says the base does not ship it. Two new Studio strings carry those sentences, in English and Chinese.
