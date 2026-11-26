---
'@object-ui/plugin-kanban': patch
---

fix(plugin-kanban): a kanban drawn in swimlanes shows the lane statistic the view settings offer

Clause-②: no
Metadata-protocol: none

A board drawn in swimlanes (a view with grouping, or `swimlaneField`) drew no lane statistic, although the view settings offer count, sum, avg, min and max on every kanban. A picked "Sum of amount" showed nothing. The board now draws the statistic once per column, in a foot row under every swimlane. The figure is the column's across every swimlane, the same one the flat board draws, read by the same grouped lane read (grouped by the column field alone). No cell (column × swimlane) draws a figure of its own, because no read groups by the swimlane field.

On a board whose host hands it one page of rows with their query (lanes over a lookup field in a list view), the swimlane layout's column counts and header totals are now the whole lane's from that same read. While the read is pending, refused or cut, they are the page's figures marked `+`. A swimlane row's own count is the cards drawn, and it carries `+` unless the page holds every record of the query. A swimlane board does not add the lanes that exist only past the page, as the flat board does.
