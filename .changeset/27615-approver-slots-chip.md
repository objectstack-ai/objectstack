---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

fix(app-shell): an approver chip that stands for several of a step's slots says so in words, so it reads with the eligible-approver count beside the tally

Clause-②: yes (widening)
Metadata-protocol: none

When one person holds several of a pending step's approver slots (the stock showcase's committee quorum routes manager, finance and legal to the seeded admin), the "Waiting on" chip collapsed those slots into one chip with a bare `×3`, drawn beside "1 eligible approver". Both numbers were right, but side by side they read as a contradiction.

- **The chip.** Where it drew `×N`, it now draws the pack's words for what N counts: "Dev Admin · holds 3 approver slots". The same copy is drawn on the business record's approvals panel and on the approval request page.
- **The counts.** Unchanged. The chip still stands for every slot its person fills, and the eligible-approver count still counts that person once.
- **`@object-ui/i18n`.** A new count family, `approvalsInbox.approverSlots`, in all ten language packs, with every plural category each language selects.
