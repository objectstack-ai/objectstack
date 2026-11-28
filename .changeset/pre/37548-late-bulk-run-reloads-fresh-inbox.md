---
'@object-ui/console': patch
---

fix(console): a bulk approve or reject that settles after the user left the Approvals inbox and came back reloads the inbox they came back to

Clause-②: no
Metadata-protocol: none

- A bulk run keeps going when the user leaves the inbox. If they opened the inbox again before it finished, that fresh inbox kept the rows it had read before the run's decisions landed, and its "My Pending" badge kept the old count, until a manual refresh. Now, when the run settles, every inbox open at that moment reloads its list and badge once: the one the run started on if the user stayed, or the fresh one if they left and came back.
- With no inbox open when the run settles, nothing is re-read, as before. The run's toast and its "Show all" action (objectstack#37328) are unchanged.
