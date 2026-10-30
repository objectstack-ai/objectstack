---
'@object-ui/plugin-list': patch
'@object-ui/plugin-detail': patch
---

fix(ui): a refused list or related-list read says "no access" and offers no Retry

Clause-②: no
Metadata-protocol: none

- **List view.** A permission refusal (403) on a list read draws the no-access panel without the Retry button, the same way an object whose API is switched off already did: a retry re-reaches the same refusal. A network failure or a 5xx keeps Retry.
- **Related list.** A related list the reader may not read draws a quiet, neutral line (`role="status"`, no destructive styling) with the list's no-access sentence, and no Retry. It no longer shows the generic action refusal ("You do not have permission to perform this action.") in red to someone who only opened the record. Other read failures are drawn as before.
