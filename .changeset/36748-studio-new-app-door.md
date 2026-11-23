---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

fix(studio): 「新建自己的应用」 on the Studio landing ends with an app, a new object joins that app's menu, and an empty menu is not blamed on access

Clause-②: yes (widening) — new i18n keys in the studio namespace (`engine.studio.newApp.*`, `engine.studio.data.appMenu.*`) and in all 11 app-shell locale packs (`empty.appMenuEmpty`, `empty.appMenuEmptyDescription`, `empty.openInStudio`); new exports `storedMenuIsEmpty` (console) and `addNewObjectToAppMenu` / `objectMenuEntry` (studio). Additive only; nothing is removed or renamed.
Metadata-protocol: none

The landing's "New app of your own" card opened the create-package dialog unchanged: it created a package and no app, and the author then had to find "Create app" in the top bar, which saved a draft that opened only after a package publish. The card now opens one "New app" dialog, worded for an app throughout (in Chinese it says 「应用」, never 「软件包」), and one confirm creates the package and its app. The app is written and published at once, like every other item a person creates in Studio, so it opens as soon as the dialog closes. A free app name (the package's namespace, else `NAMESPACE_app`) is checked before anything is written, so a taken name refuses the confirm and writes nothing.

The Studio top bar's left end named an app only when there was one to go back to. A package with no app read "Back to app · Studio" and did not say which package was open; it now shows the package's name in that place.

The top bar's own "Create app" button and the package dialog on the Packages page are unchanged.

A new app's menu started empty, and nothing ever filled it: an object created later in Studio did not appear in the app, which opened on an empty screen. Studio's "New object" now adds the new object to the menu of its package's app once the object is live, when the package has exactly one app and no menu entry already opens the object. The entry is written through the design mode's menu save (a draft, then the app's publish), so a draft somebody left pending on the app is refused rather than overwritten. A refused menu save keeps the object and says so in a warning; the menu can be edited in design mode. With several apps, which menu gets the object stays the author's choice in design mode.

An app whose menu is empty, as stored, told an administrator to grant access in Setup. For a person who can grant access, the screen now reads the app's stored menu: when it is empty there too, it says the app has nothing in its menu yet and opens the app's package in Studio. A stored menu with entries this person is not shown, or a failed read, keeps the access answer.
