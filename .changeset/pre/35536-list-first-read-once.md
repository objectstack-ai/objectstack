---
'@object-ui/plugin-list': patch
---

fix(plugin-list): a list page reads its first page once on a cold load, also when the view definitions arrive after the first read

Clause-②: no
Metadata-protocol: none

Opening a list no longer sends the same first-page request twice when the saved view definitions answer after the list has already started reading: a host that hands over an equal view again (a fresh `data` block of the same content) no longer re-arms the read. A real change still reads again: the view's filter or sort, a view switch, or the reader's own filter or sort.
