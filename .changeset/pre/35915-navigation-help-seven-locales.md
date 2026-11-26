---
'@objectstack/platform-objects': patch
---

fix(platform-objects): the view form's navigation help no longer says rows open in a drawer by default in Arabic, German, French, Korean, Brazilian Portuguese, Russian and Traditional Chinese

Clause-②: no
Metadata-protocol: none

The `navigation` and `navigation.mode` help texts of the view metadata form are now translated from the current English in these seven locales, matching the zh-CN, ja-JP and es-ES wording: `mode` is deprecated on an object's list (the record name opens the full page, the hover icon the side panel), and `none` still means rows open nothing. Before, the `navigation` help still said the drawer is the default, and `navigation.mode` showed an older English copy.
