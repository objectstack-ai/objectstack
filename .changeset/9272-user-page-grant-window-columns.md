---
"@objectstack/platform-objects": minor
---

The user page's "Permission Sets" list shows each assignment's validity window, `valid_from` and `valid_until` (ADR-0091 D1/D2)

The resolver drops a `sys_user_permission_set` assignment outside its half-open `[valid_from, valid_until)` window at every evaluation, so a list that showed only the set presented an expired or not-yet-active assignment as a live grant. The two bounds now sit beside the set. The list's Add affordance still writes the user and the set only; the window is set by editing the assignment row.
