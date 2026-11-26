---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(studio): 「全部类型」 All types ends the 高级 fold, and the type directory lists every type a package could hold

Clause-②: no
Metadata-protocol: none

Studio's 高级 Advanced fold lists a type only when the package holds one, so a new app showed no way to make its first email template, document, book, field mapping, seed data or AI context pack. The fold now ends with one row under no group, 全部类型 All types, which opens the type directory. On a package that page lists the types the package holds, as before, and after them in each group every other type of the menu's six groups, marked None yet (zh: 还没有) with the word that says what can be done there; a tile opens the type's list, whose New makes the first item. Types that cannot be made in Studio are listed as read-only, and Hide read-only drops them. The fold's own rule is unchanged: a 高级 type appears in it once the package holds one. The directory is the row's current page.

New locale keys in the studio catalogue (en, zh): `engine.studio.menu.allTypes`, `engine.directory.notHeld`, `engine.directory.notHeldTitle`, `engine.directory.notHeldReadOnlyTitle`. No props or entry exports change.
