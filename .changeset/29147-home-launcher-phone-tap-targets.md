---
'@object-ui/app-shell': patch
---

fix(app-shell): below `sm`, every Console home launcher link and button meets the 44 px touch target

Clause-②: no
Metadata-protocol: none

At phone width the home page's links and buttons were 16 to 32 px tall: the builder chips and AI buttons in the greeting row, the "Your apps" heading links and "Show less", "Open inbox", both "View all" links, the My-work and recent rows, the pending-drafts "Publish" button and "View all activity". Each now takes 44 px below `sm` (`max-sm:` classes), and a short text link is also at least 44 px wide. From `sm` up nothing changes. The strip's classes also reach the `app:launcher` block, which renders the same component.
