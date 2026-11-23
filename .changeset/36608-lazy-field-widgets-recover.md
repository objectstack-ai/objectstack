---
'@object-ui/fields': patch
---

fix(fields): a lazily loaded field widget whose chunk failed to load once loads again on its next mount, with no page reload

Clause-②: no
Metadata-protocol: none

The date and datetime pickers, the rich-content editor and read face, the filter-condition cell, the image field's crop dialog and every widget reached through `getLazyFieldWidget` or `registerField` were `React.lazy` components. A lazy component keeps its first import outcome, a rejection included, so after one failed chunk load (a deploy that replaced the chunk, a dropped connection) the widget stayed broken until the page was reloaded. They now load through one shared wrapper: loading and loaded behave as before (the host's `Suspense` fallback shows while the chunk loads), a failed load still reaches the nearest error boundary, and the next mount (an error boundary's reset, a reopened form, a revisited page) asks for the chunk again. The mounted widget that saw the failure does not retry by itself, so an unreachable chunk is not requested in a loop.
