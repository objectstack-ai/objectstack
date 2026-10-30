---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

fix(console): an empty report index points at the apps that have reports

Clause-②: no
Metadata-protocol: none

An app's report index with nothing to list, such as Setup's All reports, said only "This app has no reports you can open." It now also lists the other apps whose report index has a report for the reader, each linking to that app's index: an app counts when it ships at least one report whose datasets the reader may read, the same served reports and read rule the index uses. The current app, an app that ships no report, and an app whose reports the reader may not read are not listed. The sidebar entry stays static by design. One key is added in all ten locale packs: `console.reportIndex.otherApps`.
