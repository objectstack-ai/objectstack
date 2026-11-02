---
'@object-ui/console': patch
'@object-ui/app-shell': patch
---

fix(console): the approvals flow works at phone width — 44 px controls, and a long inbox stays responsive

Clause-②: no
Metadata-protocol: none

The mobile app hosts the Console in a WebView, so a phone approver gets the Console at 375 px. Measured in Chromium at 375×812 and 390×844 on the showcase and CRM examples:

- **Touch targets.** Below 768 px the approvals inbox's tabs, search field, filters, the phone cards' Approve / Reject and the inline approve / reject confirmations' buttons take a 44 px height (Button's `lg` size, `h-11` where a control has no size); they measured 28–40 px. The record page approval panel's Send reminder does too (it was 24 px). A desktop keeps every size it had.
- **No zoom on focus.** The inbox search field keeps the 16 px text inputs use on a phone, so focusing it no longer makes iOS zoom the page.
- **A long inbox stays responsive.** The inline confirmations now hold their own row and Reject reason, the rows are memoised, and the pending list follows the search box at a deferred priority. At 200 pending requests on a phone at 4× CPU, typing a 20-character reject reason went from 8.4 s to 0.5 s, opening a confirmation from about 1 s to 0.3 s, and the longest task while deciding or searching from about 850 ms to 120 ms.
