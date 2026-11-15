---
'@object-ui/console': patch
---

fix(console): a screen run finished from the Flow Runs test panel no longer reads as paused

Clause-②: no
Metadata-protocol: none

On the developer Flow Runs page, a screen flow's test run that the runner drove to completion left the Test Run panel showing the trigger's paused answer: "Waiting for input", "This run is paused at screen …" and a "Continue run" button. Continuing reopened the old screen, and submitting it answered 404 `RUN_NOT_FOUND`, because the server no longer holds a suspended run. When the runner completes the run, the panel now reads the run back (`automation.getRun`) and shows it as the result, with its final status and duration, and offers no "Continue run". A run the tester dismisses while it is still paused keeps its "Continue run", as before.
