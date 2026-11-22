---
'@object-ui/plugin-detail': patch
---

fix(plugin-detail): a record Overview body table keeps the totals of the summed columns it leaves out for width

Clause-②: no
Metadata-protocol: none

On the record page's Overview, a master-detail body table draws only the leading columns that fit whole and leaves the rest behind 「全部列」 / All columns. A summed column left out that way also lost its total, so an amount such as a line total vanished from the Overview only because its column did not fit. The table now draws a line under itself with the total of every summed column it left out, each labelled with the column's name and formatted as that column's own total is (the page record's currency for a line amount that follows its parent). The drawn columns keep their totals in the table's last row, unchanged; when every summed column is left out, that row (which would read 「合计」 over empty cells) is not drawn and the line carries the totals. A table that leaves no summed column out shows no added line. No string is added: the line reuses the existing `form.masterDetail.total` label and the columns' own names.
