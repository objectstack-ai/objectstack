---
"@objectstack/platform-objects": patch
---

fix(platform-objects): make the System Overview "Total Users" and "Active Sessions" tiles count what their labels say (#7531)

Two tiles on the shipped **System Overview** board reported a different quantity
from the one on the card. Neither number was stale or fabricated — each equalled
its own captured query and an independent direct aggregate — the query was
simply answering a different question from the label.

**"Total Users" was a 7-day count.** The board declares a `created_at` global
filter defaulting to `last_7_days`, and a dashboard-level filter is broadcast
into *every* widget's analytics query (#2501). `sys_user.created_at` exists, so
the broadcast landed on it and the tile reported "users created in the last 7
days" under a label that says "Total". On a fresh datastore the two coincide —
every user *is* recent — which is why it reads as correct in a demo and as a
catastrophic user-loss event on any instance older than the window. The tile now
opts out with `filterBindings: { created_at: false }`.

**"Active Sessions" counted every session.** `sys_session_metrics` is a bare
count over `sys_session` and the widget carried no predicate, so a signed-out or
long-expired session was still reported as active. `sys_session` can express
"active" exactly (ADR-0069 D4): the tile now filters
`{ revoked_at: null, expires_at: { $gt: '{now}' } }`. It opts out of the date
bar as well — "currently active" is a statement about now, not about a window,
so an old session that is still live must still count.

The date bar is untouched where it belongs: all six `sys_audit_log` widgets
(rows 2-4) still inherit it, which is what it was added for.

No labels changed and no translation keys move — the fix is to the queries, not
the wording. Behaviour change to be aware of when upgrading: on an instance
older than the selected window both tiles will now read **higher** than before
for Total Users, and typically **lower** for Active Sessions.

Still outstanding, filed separately: the same `created_at` fan-out also reaches
the other two Row 1 inventory tiles, "Organizations" and "Packages Installed".
