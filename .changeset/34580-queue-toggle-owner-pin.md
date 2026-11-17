---
'@object-ui/plugin-list': patch
---

fix(plugin-list): the list toolbar no longer offers the "In a queue" toggle on a view whose own filter pins `owner_id`

Clause-②: no
Metadata-protocol: none

The "In a queue" toggle adds `owner_id is_empty` and `queue is_not_empty` to the list's query. On a view whose own filter already requires an owner, such as a "My records" view filtered by `owner_id equals {current_user_id}`, the two conditions contradict each other, so turning the toggle on always showed an empty list. The toggle is now withheld when the view's filter has a top-level AND condition on `owner_id` with `equals` (a non-empty value), `in` (a list of non-empty values) or `is_not_empty`. A condition inside an OR group does not count, because the other members of the group can still match unowned records.

While the toggle is withheld it adds nothing to the query. If it was on when the user switched to such a view, it is turned off, so switching back to a view that offers it shows it off.

Nothing changes on views without an owner condition, and no metadata or server behaviour changes.
