---
'@object-ui/app-shell': patch
---

fix: a chart view's view bar starts its view icon on the list page's 16px left edge, as the list view's bar does

Clause-②: no
Metadata-protocol: none

A chart view draws its own copy of the view bar, and that copy kept `sm:px-4` after the list view's bar moved to `sm:pl-2.5 sm:pr-2` in #35663. From `sm` up the chart's view icon sat 22px from the main area's left edge while the list's sat at 16, so switching between a list view and a chart view moved the switcher. The chart bar now carries the list bar's padding: at 1280 its icon starts at 16 and its right padding is the list bar's 8. Below `sm` both bars keep `px-2`, so a phone is unchanged.

The list renderer's `inSetup` input is gone. Since #35663 removed the Setup app's row-number line it was read only in a memo's dependency list, so `ObjectView` no longer derives it from the route.
