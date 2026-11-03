---
'@object-ui/app-shell': patch
---

fix(app-shell): switching a report to Joined in Studio also clears its `dateRange` and `exportOptions`

Clause-②: no
Metadata-protocol: none

A joined report refuses a container `dateRange` and `exportOptions`, and the report form hides both once the type is Joined. The report type picker cleared the dataset binding, chart and order on that switch but kept these two, so a report that carried either one saved into a refusal at a key no visible control reached. The switch now clears them in the same patch. Switching back to a non-joined type restores neither, and switching between two non-joined types keeps both.
