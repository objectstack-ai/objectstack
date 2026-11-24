---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

fix(console): the Change Owner dialog's queue target offers the queues an installed app declares, not only the organization's `sys_queue` rows

Clause-②: no
Metadata-protocol: none

A queue can live in two places (ADR-0142 D1): a `sys_queue` row the organization authored, or a `queue` item an installed package declares. The Change Owner dialog's queue target searched `sys_queue` alone, so a declared queue could be named everywhere else (sharing-rule recipients, flow approvers) but never picked as a record's new owner. The queue target now lists the declared queues as their own choices under the `sys_queue` lookup, built by `mergeQueueCandidates`, the merge the other queue pickers use. The server resolves a queue name registry-first, so when a `sys_queue` row shares a declared queue's name, the declared queue is the one offered and the lookup leaves that row out. Either choice sends the queue's name, as before. The `sys_queue` lookup keeps its server search and paging; a declared read that fails offers no declared queue and leaves the lookup working.

`@object-ui/i18n` adds one key, `console.changeOwner.declaredQueues`, in every locale pack.
