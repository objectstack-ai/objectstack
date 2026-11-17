---
'@object-ui/components': patch
---

fix(components): a form's phone-width field-tab strip scrolls a tab activated by a failed submit into view in the same commit

Clause-②: no
Metadata-protocol: none

Below `sm`, a horizontal `fieldTabs` strip that does not fit scrolls sideways, and the active tab is scrolled into its visible window. That scroll ran in a passive effect. When the activation came from a non-discrete update, such as a failed submit jumping to the first tab holding an invalid field (react-hook-form validates asynchronously), the passive effect ran a task after the commit. For that window the newly active tab was painted while still scrolled out of the strip. The scroll now runs in a layout effect, so it lands in the same commit that marks the tab active, before paint. Tapping a tab and opening on an off-screen `defaultFieldTab` behave as before.
