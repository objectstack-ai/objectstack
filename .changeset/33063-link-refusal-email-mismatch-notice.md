---
'@object-ui/console': patch
'@object-ui/i18n': patch
---

fix(console): a signed-in person whose account link is refused because the emails differ is told why on the page they land on

Clause-②: yes (widening) — the `@object-ui/i18n` locale packs gain one key, `auth.login.errors.linkEmailMismatch`, in all eleven shipped locales; no key is renamed or removed.
Metadata-protocol: none

Linking another sign-in to your account (`POST /api/v1/auth/link-social`, then the provider's round trip) is refused when the provider account's email differs from yours, and the callback redirects to the Console sign-in page with `error=email_does_not_match`. You are still signed in there, so the page sent you straight on to the console and the reason was lost: the account was simply not linked, with no word why. The sign-in page now keeps that code for the page you land on, which shows an error toast saying the account was not linked because its email address doesn't match the one on the account you're signed in with, in your language. The toast stays until you close it and is shown once. Only codes the Console has a sentence for are kept, and only as a code; nothing from the URL is shown as it came. The refusal itself is unchanged, and a signed-out visitor still reads the sign-in page's own sentence for the code they came back with.
