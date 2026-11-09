---
'@object-ui/app-shell': patch
'@object-ui/console': patch
---

fix(console): a language picked on the register page is saved as the new person's own language when registering signs them in (#30338)

Clause-②: no
Metadata-protocol: none

A language picked in the register page's menu used to apply on that browser only: once the sign-up signed the person in, their saved language stayed empty, so another device, or the language their mail is written in, did not follow the pick. The register page now saves the pick to the person's own language setting before it moves on, the way the sign-in page does, on every way it leaves after a sign-up, joining an organization from an invitation link included. `DefaultRegisterPage` does the same for a pick made earlier on another signed-out page. Nothing is saved when no language was picked, a language the person already has is kept, and a save that fails does not hold up the sign-up (the pick still applies on that browser). A pick followed by a reload of the register page, or by an identity provider's redirect, is still not saved.
