---
'@object-ui/console': patch
'@object-ui/i18n': patch
---

fix(console): the profile Language card says it is the same setting as the globe menu

Clause-②: no
Metadata-protocol: none

The Language card on the profile page described itself as the language for notifications and messages only, and said the interface language was chosen separately from the globe menu. Both controls write the same `sys_user.locale` column and the console applies it as the interface language, so saving the card switched the whole console. The card's description (`profile.language.description`, in all ten built-in packs and in the console's own fallback text) now says it is one setting for the interface and for what is sent to the user, the same one as the globe menu. The zh-Hans text uses full-width punctuation. Nothing to migrate.
