---
'@objectstack/skills': patch
---

docs(skills): objectstack-api and objectstack-i18n teach the request-locale `userMessage`

Clause-②: no
Metadata-protocol: none

`objectstack-api` § Error Envelopes now states the `userMessage` language rule as `ApiErrorSchema.userMessage` declares it: the text is in the request's locale; platform-composed text follows one ladder over the platform locale table (the locale the request names, else the workspace default, else `en`, each code read whole and then one subtag shorter at a time); app-authored text is served from the app's own translations and otherwise as declared, with no `en` floor. It also says that an entry of the save / publish doors' `advisories[]` and of the 422 `issues[]` (`RuntimeAuthoringIssueSchema`) carries an optional `userMessage` beside the stable `rule`, while `message` / `hint` stay developer-facing English. `objectstack-i18n` gains a short section with the same ladder and the `hooks.<hook>.refusals.<CODE>.message` key an app translates its catalogued refusals under. Growth is paid by same-file deletions of restated prose: both files read fewer tokens than before, and no ratchet ceiling moves.
