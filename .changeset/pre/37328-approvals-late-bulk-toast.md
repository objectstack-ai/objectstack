---
'@object-ui/console': patch
---

fix(console): a bulk approve or reject that finishes after leaving the Approvals Inbox opens its failed rows back on the inbox

Clause-②: no
Metadata-protocol: none

A bulk run keeps going when the decider leaves the Approvals Inbox. When it finished after the page had closed, it raised its "N succeeded, M failed" toast with a "Show all (M)" button that opened nothing, because the dialog it opened belonged to the closed page.

Now that button takes the decider back to the inbox the run started on and opens the list of that run's failed rows, each with its reason. A run that finishes while the inbox is still open works as before: "Show all" opens the list in place. A run that finishes after the page closed no longer reloads the closed page's list or badge count. Nothing to migrate.
