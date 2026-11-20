---
'@object-ui/plugin-list': patch
'@object-ui/app-shell': patch
---

fix(list): a list opened from a record shows its condition once, by name

Clause-②: no
Metadata-protocol: none

A list opened from a record's related tab (「↗」) now shows its condition once, as the data page's own 「Filtered by」 tag: the list under it still filters on the condition but no longer repeats it as a locked chip printing the record's raw id beside a second 「Reset」. Where a list does lock a lookup condition (a saved view filtered on a lookup), the chip names the record it points at — and so does the reader's own lookup filter chip — keeping the id only when the name cannot be read. The condition row's 「Reset」 is drawn only while the reader has something of their own to reset (a filter they added, a sort they changed); it is no longer drawn disabled.

`ListView` takes a host prop, `hostDrawnConditionFields`: the fields whose conditions in `schema.filter` the host draws as its own tags. The list keeps filtering on them and draws no locked chip for them. It is not a schema key.
