---
'@object-ui/console': patch
'@object-ui/i18n': patch
---

fix(console): a signed-in person whose account link is refused as already linked to another user, or as unable to link, is told why on the page they land on

Clause-②: yes (widening) — the `@object-ui/i18n` locale packs gain two keys, `auth.login.errors.linkAlreadyLinkedToOtherUser` and `auth.login.errors.linkUnableToLink`, in all eleven shipped locales; no key is renamed or removed.
Metadata-protocol: none

Linking another sign-in to your account can be refused by the server for two more reasons besides a different email: the provider account is already linked to a different user here (`account_already_linked_to_different_user`), or it could not be linked at all (`unable_to_link_account`, chiefly when the sign-in service did not confirm the account's email as verified). Both send you back to the Console sign-in page, which, because you are still signed in, sent you straight on to the console with no word. Each now travels the same way as the email mismatch: the page you land on shows an error toast with its own sentence, in your language, until you close it. The sentence names no other user or email, and nothing from the URL is shown as it came. The refusals themselves are unchanged.
