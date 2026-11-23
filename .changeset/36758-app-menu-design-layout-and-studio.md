---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

fix(console): the app-name menu offers 「Design layout」 for the design mode and 「Edit app」 for Studio

Clause-②: no
Metadata-protocol: none

The app-name menu's 「Edit app」 entered the design mode, which edits only the app's layout (its menu, header pins and page arrangement), and no desktop surface opened the app itself in Studio. The menu now has two entries under the list of apps, in one group with 「Add app」:

- 「Design layout」 (zh 「设计布局」) turns the design mode on, on the same condition as before. The mode's bar now reads 「Design layout」 too, and so do the strings that name the mode (the leave prompt, the menu editor's notes).
- 「Edit app」 (zh 「编辑应用」) opens this app's package in Studio, on the app switcher's Studio target: an object page opens that object in the Data pillar, a dashboard, page or report its design surface. An installed (read-only) package's app reads 「View in Studio」 (zh 「在 Studio 中查看」) behind an eye instead, and opens Studio's browse-only posture. It is offered on the Studio entry's own condition: a workspace admin holding `manage_metadata`, on an app whose package Studio lists (the console's own Setup, Studio and Account apps get none).

Two locale keys are added in every built-in pack, `topbar.designLayout` and `topbar.viewInStudio`; `topbar.editApp` keeps its words and now names the Studio entry wherever it is drawn.
