---
'@object-ui/console': patch
'@object-ui/i18n': patch
---

fix(console): the shared-record page shows a user field as "Linked user", never its sys_user id

Clause-②: yes (widening)
Metadata-protocol: none

- **`@object-ui/console`**: on a share link (`/s/TOKEN`), a user field with a value now reads "Linked user" instead of the stored `sys_user` id, which an anonymous visitor could not use. An empty one still reads as empty. It follows the lookup rule from the same page: the field is recognized by the `type: 'user'` the resolve answer's `fields` projection already serves, the page sends no extra request, and nothing reads the user record.
- **`@object-ui/i18n`**: every pack gains `sharedRecord.linkedUser` (en "Linked user", zh-Hans 「已关联用户」).
