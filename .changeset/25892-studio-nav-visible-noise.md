---
'@object-ui/app-shell': patch
---

fix(app-shell): the Studio no longer prints a warning for every navigation `visible` predicate of the apps it lists

Clause-②: no
Metadata-protocol: none

Opening the Studio printed one "A visibility predicate could not be evaluated - node app-shell:visible" warning per gated navigation entry of every installed app (ten for HotCRM), for predicates such as `!("sales_rep" in current_user.positions)` and `current_user.can("crm_lead", "read")` that evaluate cleanly inside the app. The header's notification bell builds its activity list from every app's navigation, and the Studio mounts no expression scope, so `current_user` was empty and no permissions were bound there: every such predicate faulted, and the warning read as an authoring error.

On a screen that mounts no expression scope, such as the Studio, a navigation entry whose predicate cannot be answered is still left out, exactly as before, but nothing is printed for it: the screen only lists from the app's navigation, it does not render it. Inside an app, where the scope is bound, a predicate that really cannot be evaluated is still reported as before.

What to do: nothing.
