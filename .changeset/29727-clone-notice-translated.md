---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

fix(app-shell): Studio's "New similar" notices for a flow and a permission set read in the console's language

Clause-②: yes (widening)
Metadata-protocol: none

The flow and permission-set clone doors name their notice by a stable `noticeCode` beside the English `notice`. The Console now maps each known code to its own sentence in en and zh: `FLOW_CLONE_DISABLED_COPY` on the Automations "New similar" strip, and `PERMISSION_SET_CLONE_ENVIRONMENT_WIDE`, `PERMISSION_SET_CLONE_IN_PACKAGE` and `PERMISSION_SET_CLONE_IN_CREATED_PACKAGE` on the Access "New similar" strip and the permission matrix's clone notice, naming the package the answer's `package` names. A code the Console does not know, an answer with no code, and a package-landing code whose answer names no package show the door's `notice` as sent, as before. A zh-CN builder therefore no longer reads these sentences in English.

New studio-namespace keys, in en and zh: `engine.studio.auto.newSimilar.notice`, `perm.clone.notice.environmentWide`, `perm.clone.notice.inPackage` and `perm.clone.notice.inCreatedPackage`.
