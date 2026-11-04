---
'@object-ui/app-shell': patch
'@object-ui/components': patch
'@object-ui/plugin-detail': patch
---

fix(ui): a greyed action's `disabledReason` tooltip wraps inside a phone-width viewport instead of running off-screen (#29954)

Clause-②: no
Metadata-protocol: none

The record action bar, the `record:quick_actions` button and the schema-driven `action:*` controls (button, icon, group, menu, through the shared disabled-reason trigger) rendered the authored `disabledReason` in a tooltip with no width bound, so a long reason sat on one line and was cut at the right edge of a 390px viewport. All three tooltips now carry the same `max-w-xs` bound the home page's disabled-reason tooltip uses, so the reason wraps.
