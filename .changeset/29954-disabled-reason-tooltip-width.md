---
'@object-ui/app-shell': patch
'@object-ui/plugin-detail': patch
---

fix(ui): a greyed action's `disabledReason` tooltip wraps inside a phone-width viewport instead of running off-screen (#29954)

Clause-②: no
Metadata-protocol: none

The record action bar and the `record:quick_actions` button rendered the authored `disabledReason` in a tooltip with no width bound, so a long reason sat on one line and was cut at the right edge of a 390px viewport. Both tooltips now carry the same `max-w-xs` bound the home page's disabled-reason tooltip uses, so the reason wraps.
