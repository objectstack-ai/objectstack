---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(studio): a contributed nav entry shows the label the live app shows, and a package that only contributes navigation says where it goes

Clause-②: no
Metadata-protocol: none

- **The label.** A navigation entry another package contributes to a base's app now shows the label the live app shows, with its id as a muted second line under it. Before, the row showed only the id. The label is looked up by `(app, id)` in the app row the Interfaces pillar already reads (`GET /meta/app?package=`), which serves the folded navigation: the served entries the app's published layer does not hold. No request is added and nothing is read from the contributor's manifest. An id the base also holds, or one two contributions share, keeps the bare id, so no label is guessed. A label-less entry reads what it inherits, through the rail's own resolver. A never-published app has no served row, so its contributed rows keep the id.
- **The contributor's empty state.** A package with no app of its own whose listed manifest declares `navigationContributions` now says what it adds: "This package has no app of its own. It adds 2 navigation entries to HotCRM's app.", with a button that opens that package. The declared app is an address only. Its owner comes from the served app read (`GET /meta/app/:app`), and the count comes from the owner's served customization read (`GET /packages/:owner/customizations`), counting the `nav` contributions stamped with this package for that app. That is at most two reads per declared target app, sent only on that empty state. When the package is disabled, the target app is missing, either read fails, or the count is 0, the text stays "This package has no app yet."
- **New strings.** `@object-ui/i18n`'s studio namespace gains five keys in `en` and `zh` (`engine.studio.if.noOwnApp`, `.noOwnAppTitle`, `.contributesOne`, `.contributesOther`, `.openOwner`).
