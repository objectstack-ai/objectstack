---
'@object-ui/plugin-list': patch
---

fix(plugin-list): a date condition's value reads as a date in the viewer's language

Clause-②: no
Metadata-protocol: none

A list condition chip on a date field printed the stored value as written, so a
drilled dashboard bucket read 「创建时间：≥ 2026-10-01T00:00:00.000Z」 in a zh-CN
session. Every condition row (the reader's chips and the view's locked chips) now
formats a date-family value by the field's type through the console's one date
display path (`formatDate` / `formatDateTime` from `@object-ui/core`), in the
display locale: a `date` field shows the day with its year (an instant at UTC
midnight shows that calendar day in every zone), a `datetime` field shows the
date and time in the display zone, and a `time` field or an unreadable value is
shown as written. The filter the list sends is unchanged.
