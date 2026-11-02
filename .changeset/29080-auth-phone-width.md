---
'@object-ui/auth': patch
'@object-ui/app-shell': patch
'@object-ui/console': patch
---

fix(auth): sign-in, password reset and the authenticator set-up work at phone width

Clause-②: no
Metadata-protocol: none

Measured in a real Console at 375 and 390 px, against the showcase and CRM examples. No page scrolled sideways, but three things failed on a phone, and all three are fixed. Above the `sm` breakpoint nothing changes.

- Every control on the sign-in, forgot-password and reset-password pages, and in the remediation overlay, was under the 44 px touch-target floor: 40 px fields and buttons, a 28 px show-password toggle, text links 14 to 17 px tall, the 32 px language button. Below `sm` each is now at least 44 px. Links inside a sentence keep their size.
- The sign-in and forgot-password fields used 14 px text, so iOS zoomed the page each time one took focus. They use 16 px on a phone.
- The authenticator set-up step of the remediation overlay (QR code, backup codes, code field) is taller than a phone screen once the keyboard is up, and the overlay did not scroll: the heading went off the top and the Verify button under the keyboard, out of reach. The overlay now scrolls.

What to do: nothing.
