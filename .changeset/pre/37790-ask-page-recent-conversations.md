---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(app-shell): an app's AI inquiry page lists its recent conversations on the home state

Clause-②: no
Metadata-protocol: none

Below the question box, the `ai:chat` page's home state lists the newest five conversations the caller started on this page for this app (title and when it was last active), read from the caller's newest 50 conversations and kept by their `metadata.activePackageId`. A conversation started in the assistant drawer, or on another app's page, is not listed; with none, the section says so. Choosing one opens it in the page through its `?c=` address. The conversation-history list row (`ConversationListItem`) now carries the row's `metadata` when it is a record. New strings: `console.ai.askPage.recentTitle` and `console.ai.askPage.recentEmpty`.
