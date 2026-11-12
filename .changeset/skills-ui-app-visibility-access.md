---
'@objectstack/skills': patch
---

docs(skills): objectstack-ui teaches who sees an app (`tabPermissions`) and who may open it (app `requiredPermissions`)

Clause-②: no
Metadata-protocol: none

`objectstack-ui` `rules/navigation.md` gains § Who sees or opens an app. A permission set's `tabPermissions: { APP_NAME: 'hidden' }` takes an app off its holders' Home tiles, App Switcher and `app:launcher` block (`GET /api/v1/me/apps` drops it); `/api/v1/meta/app` still serves it and its URL still opens, so it is visibility, not access. Any other value for that app on another set the person holds (`visible`, `default_on`, `default_off`) outranks `hidden`, so the set everyone holds must carry no `tabPermissions` entry for it. Access is the app's `requiredPermissions` plus a `systemPermissions` grant on the holders' permission set, and administrators need that grant too. The app's own `hidden: true` keeps it off the switcher for everyone. There is no per-position default app: an app's `isDefault` is global. `SKILL.md` § App Navigation points at the section, `objectstack-data` `rules/security.md` gains one line under permission sets, and the `objectstack-ui` evals gain a case.

The new text is paid for inside each file: the `hidden` and `defaultAgent` comments of the `App.create` example (the first now lives in the new section, the second is taught by `objectstack-ai`), and sentences that repeated a rule stated beside them.
