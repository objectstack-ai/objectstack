---
'@object-ui/app-shell': patch
---

fix(app-shell): the draft preview's failure pane is announced as an alert, drawn by the shared `DataErrorState`

Clause-②: no (one surface swaps its own block for the shared components; no exported type change. If the shared component needs a new prop, the thread reports first and the seat amends this line)
Metadata-protocol: none

The pane a `?preview=draft` tree shows when it has nothing to draw (`PreviewDraftEmptyState`) now uses the shared view states from `@object-ui/components` instead of its own `Empty` block. When the draft overlay read fails, it is `DataErrorState` and is announced to assistive technology as `role="alert"`. When the app is not in the draft yet, or nothing is drafted, it is `DataEmptyState` with `role="status"`. Before, both were the same unlabelled node, so a screen reader said nothing when the preview failed to load. The text, the Retry button and the test ids are unchanged; the title and icon now use the shared components' smaller size.
