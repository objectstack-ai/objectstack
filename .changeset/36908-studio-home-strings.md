---
'@object-ui/i18n': patch
---

feat(i18n): strings for the customizations section in Setup → Packages and for Studio's way out of a missing package

Clause-②: no
Metadata-protocol: none

Adds the strings for the customizations section of an app's detail in Setup → Packages, and for the way out of Studio's "package not found" state. The strings of Studio's removed home page that shipped in 18.6.0 stay in the studio namespace, no longer read, so no released string is removed. Four of that page's strings that were added after 18.6.0 and never released are removed. The "New in Studio" label now reads "New blank app" in English and 「新建空白应用」 in Chinese (Simplified and Traditional); its other translations are unchanged.
