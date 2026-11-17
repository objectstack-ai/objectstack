---
'@object-ui/console': patch
'@object-ui/i18n': patch
---

feat(console): the approvals inbox's pending queue steps from request to request, and opens the next request after a decision

Clause-②: yes (widening) — two new `approvalsInbox` keys in the `@object-ui/i18n` locale packs (`openNextAfterDecision`, `queueDone`; `TranslationKeys` grows); nothing removed or renamed
Metadata-protocol: none

From the Approvals Inbox's "My pending" tab, a request now opens with the queue as the list shows it, filtered and sorted:

- The request page's top bar shows where the request sits in the queue (`1 / 3`, read out as "1 of 3 in Approvals Inbox") with the next / previous buttons and the `j` / `k` keys, and its breadcrumb leads back to the inbox. This is the counter every record page opened from a list already draws; the inbox now hands it the queue.
- A new "Open next after deciding" switch beside the counter, on by default and remembered per browser. When a decision takes the request out of your pending queue (approved, rejected, sent back, reassigned, or approved for your countersign slot while others still decide), the next request of the queue opens in its place and the decided one leaves the count. After the last one the page returns to the inbox and says the list is done. With the switch off the page stays on the decided request. An action that leaves the request waiting on you, such as asking for more information, does not move the page.
- A request opened any other way, from a notification, a direct link or the "Submitted by me" and "All" tabs, shows no counter and no switch, as before.

No approval permission, rule or server endpoint changes. `@object-ui/i18n` adds `approvalsInbox.openNextAfterDecision` and `approvalsInbox.queueDone` in all 11 shipped locales; no key is renamed or removed.
