---
'@object-ui/app-shell': patch
'@object-ui/console': patch
---

fix(app-shell): the route's object-read failure and the page's record-load failure are announced to assistive technology

Clause-②: no
Metadata-protocol: none

Two load-failure blocks in the Console drew an `Empty` with no `role`, so a screen reader heard nothing when the read failed: the route slot shown when the by-name read of the route's object gets no answer (`route-object-read-failed`), and the custom page's record-scope read failure (`page-record-load-failed`). Both are now drawn by the shared `DataErrorState` from `@object-ui/components`, which is `role="alert"` by construction, so a failed read is announced and reads differently from an empty one.

Their titles, messages, i18n keys and defaults, test ids and Retry controls are unchanged; Retry rides in the component's `children` so it keeps its own test id. The visible change is the shared component's look: a small destructive icon square above the title.
