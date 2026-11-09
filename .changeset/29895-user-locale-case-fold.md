---
'@objectstack/plugin-auth': patch
---

fix: a user's language preference is stored in its BCP-47 case, so `zh-cn` and `ZH-CN` are saved as `zh-CN` and the console renders that user's language (#29895)

Clause-②: no
Metadata-protocol: none

`sys_user.locale` used to store a tag as written. The column checks only the shape of a tag, so `zh-cn` was accepted, and the console, which picks its UI language by exact match, then rendered English for that user with no error. Every write of the column is now stored in BCP-47 case: language lower case, region upper case, script title case (`ZH-HANS-cn` → `zh-Hans-CN`). This applies to the data API (`PATCH /api/v1/data/sys_user/:id` and its bulk form), the admin user import and the identity-provider locale sync. The fold is the one `LocaleSchema` applies to translation locales. Nothing new is refused: `zh_CN` is still refused with 400, and an empty value still clears the preference. Rows stored mis-cased before this release are not rewritten. Such a row reads back as stored until the column is written again.
