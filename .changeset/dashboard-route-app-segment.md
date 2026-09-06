---
"@objectstack/lint": patch
---

`dashboard-action-route-unresolved` now resolves the `apps/NAME` head of a dashboard header action's `url` target against `stack.apps`, and reports every unresolved `<collection>/<name>` segment in the path rather than stopping at the first one it recognizes.

Before this, `URL_COLLECTION_TO_STACK_KEY` had no `apps` entry, so an `actionUrl` like `/apps/no_such_app_nope/crm_lead` was never checked at all — a dashboard button pointing at an app that does not exist passed lint clean. Worse, once a bad app name was combined with a second bad segment later in the same path (e.g. `/apps/no_such_app_nope/dashboard/no_such_dashboard_nope`), the old loop returned at the FIRST recognized segment and reported only that one — so a bad app name plus a bad dashboard name reported only the dashboard, never the app.

**Behavior change on paths that used to pass clean:** the loop no longer stops scanning a path the moment it recognizes one collection segment, resolved or not. A path like `/dashboards/exec/views/bad_view` — where `exec` is a real dashboard but `bad_view` names no view — used to report nothing (the loop returned as soon as `dashboards/exec` resolved, never reaching `views/bad_view`); it now reports one warning on the `views/bad_view` segment. Any stack with a dashboard `url` action whose path recognizes a valid collection segment followed later by an unresolved one will see a NEW warning here that did not fire before. This is intentional — it is the same false-affordance category the rule already exists to catch — but it is a real, visible change to what a clean `lint` run reports on such stacks, not a pure addition.
