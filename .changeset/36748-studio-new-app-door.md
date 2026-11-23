---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

fix(studio): 「新建自己的应用」 on the Studio landing ends with an app, and the top bar names the package when it has no app

Clause-②: no
Metadata-protocol: none

The landing's "New app of your own" card opened the create-package dialog unchanged: it created a package and no app, and the author then had to find "Create app" in the top bar, which saved a draft that opened only after a package publish. The card now opens one "New app" dialog, worded for an app throughout (in Chinese it says 「应用」, never 「软件包」), and one confirm creates the package and its app. The app is written and published at once, like every other item a person creates in Studio, so it opens as soon as the dialog closes. A free app name (the package's namespace, else `NAMESPACE_app`) is checked before anything is written, so a taken name refuses the confirm and writes nothing.

The Studio top bar's left end named an app only when there was one to go back to. A package with no app read "Back to app · Studio" and did not say which package was open; it now shows the package's name in that place.

The top bar's own "Create app" button and the package dialog on the Packages page are unchanged.
