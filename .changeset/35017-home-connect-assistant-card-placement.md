---
'@object-ui/app-shell': patch
'@object-ui/console': patch
---

fix(app-shell): Home draws the Connect an AI Assistant card after the greeting, My apps and My work, as one row on a phone

Clause-②: no
Metadata-protocol: none

Home used to open with the "Use this system in your AI assistant" card, above the greeting and the apps. On a 375 px phone its sentence wrapped to five lines, so the card took about a quarter of the first screen and pushed My apps below the middle.

- **Place.** The card now comes after the greeting, My apps and My work. When there is no My work section, it follows the apps. On a workspace with no app yet, it follows the welcome instead of sitting above it.
- **Size on a phone.** Below the `sm` breakpoint the card is one row: icon, title on one line, Connect and close. The sentence under the title is hidden from view there but screen readers still read it. From `sm` up the card looks as it did.

When the card shows has not changed. It still shows only to someone who has connected no assistant, and it stays away after they close it. The first-run checklist's row for the same item is untouched.
