---
'@object-ui/plugin-kanban': patch
'@object-ui/plugin-calendar': patch
'@object-ui/plugin-timeline': patch
'@object-ui/plugin-map': patch
---

fix(ui): the kanban, calendar, timeline and map views draw the no-access state for a refused read, not the raw error

Clause-②: no
Metadata-protocol: none

A reader who may open a page but is not granted the records its kanban board, calendar, timeline or map reads saw the transport's own string where the view would be, untranslated (for example `Error loading kanban data: ApiDataSource: HTTP 403 Forbidden — {…}`). Each of the four views now classifies a failed load with the shared load-error verdict the list page, the related list and the Gantt chart use, and for a permission refusal (a 403, or a `PERMISSION_DENIED` / `FORBIDDEN` code) draws the calm no-access state those surfaces draw: a neutral status panel with the shared `list.loadErrorForbiddenTitle` / `list.loadErrorForbiddenMessage` sentence in the reader's language, and none of the server's text. Every other failure (a 500, a dropped connection) keeps each view's existing error screen. The map's tile-style failure is not a data load and is unchanged.
