---
'@object-ui/layout': patch
---

fix(layout): the sidebar's icon rail lists the entries of a collapsed navigation group

A navigation group declared `expanded: false` (the Account app's Developer group, the Setup app's Advanced group) drew nothing in the icon rail: its label is hidden there and its closed disclosure kept its entries out of the page, so on a laptop-width window, where the console sidebar opens as the rail, and in a sidebar collapsed to icons by hand, API Keys or OAuth Applications could not be reached from the sidebar at all. `NavigationRenderer` now draws a group's entries in the icon rail whether the group is open or not, as it already did for an open group, so each entry is a rail icon with its name, reachable by pointer and keyboard. The group's own open state is untouched: the expanded sidebar, the rail's overlay included, still shows it collapsed with its entry count until the reader opens it.

Clause-②: no
Metadata-protocol: none
