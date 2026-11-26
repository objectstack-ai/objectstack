---
'@object-ui/plugin-detail': patch
'@object-ui/app-shell': patch
'@object-ui/fields': patch
'@object-ui/react': patch
---

fix(record-page): the related tab offers only 「↗」 and 「+ 添加」, and a pick of several is added all or none

Clause-②: no
Metadata-protocol: none

The record page's related tab drew a filter box, condition chips, an options menu, an export and its own New, and repeated the row count under the table. It now carries two entries at its right end. 「↗」 opens the child object's list under this record, on an empty list too. 「+ 添加」 is the one add entry, chosen by the relationship when the page authored no `add`: a `lookup` child opens a picker of that object whose first row is New; a `master_detail` child whose rows name a catalog record (one other required lookup) opens a picker of that catalog; one with no catalog opens the new-record form directly. The count shows once, in the tab title.

A pick of several records is one request to the transactional batch route: every row is added or none is, and the list says why when none was. Before, each pick was its own write, and a failure part way left the earlier rows added. A data source without the batch route offers no picker.

A child with a status and a deadline that the status settles is grouped by status on the tab: open groups first in the order the status lists them, completed groups last, each collapsible.

The reader's header sort and column widths on the tab are remembered per list in the record page's existing per-user preferences.

The list page 「↗」 opens names the record it came from: its condition tag reads the record's name, a breadcrumb leads back to it, 「Reset」 puts that condition back after the reader changed the filters, and New opens the record form linked to it.

A body table's total under a currency column whose currency does not resolve is drawn as its cells are, an amount with no symbol, instead of being left out (objectstack#35710). Rows that name their own currency are still totalled per currency.
