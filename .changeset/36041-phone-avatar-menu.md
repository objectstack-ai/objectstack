---
'@object-ui/app-shell': patch
---

fix(console): on a phone the account menu stays on the screen in every interface language

Clause-②: no
Metadata-protocol: none

The account menu sized itself to its longest line. On a phone, with the desktop notification hint showing (notifications blocked, or a browser with no notification support such as Safari on iPhone), the menu was wider than a 375 px screen in seven of the eleven interface languages (English, German, French, Russian, Spanish, Portuguese, Japanese), and in German, French, Russian, Spanish and Portuguese the Language control was pushed off the right edge, so the language list could not be opened.

Below 768 px the menu is now no wider than the screen less a 1 rem gutter on each side, and long lines wrap with their full text. The language list opens under the Language control (or above it where only that fits), on the screen. From 768 px up the menu is unchanged, and the language list itself, which the sign-in page also uses, is unchanged. No props, exports or locale keys change.
