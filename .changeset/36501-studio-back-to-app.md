---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(studio): the top bar's left end reads 「‹ Back to app」, the app's name and "Studio"; the Studio-home button, the package switcher and Open app are gone

Clause-②: no
Metadata-protocol: none

Studio's top bar now starts with one way out: 「‹ Back to app · APP · Studio」. Entered from an app, the link names that app and returns to the page the author came from, its query included. Opened directly (a Studio address in a new tab, a reload), it names the package's published app and lands on its first screen; with several apps, the first. A package with no published app (none yet, or only a draft) and the organization flows scope read 「‹ Back to app」 with no name and go to the console's landing. Leaving with unsaved work in a pillar asks first, as every other header departure does.

The home icon, the package switcher and the top-right Open app button are removed. Another package is opened from the app, or from the Studio landing, whose cards also carry package management and New package.

New studio catalogue keys (en, zh): `engine.studio.backToApp`, `engine.studio.backToAppTitle`, `engine.studio.backToAppTitleNoApp`, `engine.studio.mark`. Removed with the Open app button: `engine.studio.openApp`, `engine.studio.openAppTitle`, `engine.studio.openAppPick`. `engine.studio.app.willOpenAfterPublish` now names 「Back to app」. No props or exports of the published packages change.
