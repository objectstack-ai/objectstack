---
'@object-ui/plugin-gantt': patch
---

fix(plugin-gantt): a refused task read draws the no-access state, not the raw error

Clause-②: no
Metadata-protocol: none

A reader who may open a record but is not granted the records its Gantt chart reads (for example a project page whose task object the role cannot read) saw the transport's own string where the chart would be, untranslated: `Error: ApiDataSource: HTTP 403 Forbidden — {…}`. The chart now classifies a failed load with the shared load-error verdict the list page and the related list use, and for a permission refusal (a 403, or a `PERMISSION_DENIED` / `FORBIDDEN` code) draws the calm no-access state those surfaces draw: a neutral status panel with the shared `list.loadErrorForbiddenTitle` / `list.loadErrorForbiddenMessage` sentence in the reader's language, and none of the server's text. Every other failure (a 500, a dropped connection) keeps the existing error screen.
