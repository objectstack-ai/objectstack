---
'@objectstack/spec': patch
---

The protocol 18 migration `page-template-closed-region-unplaced-refused` now says what the console shows for a page row stored before the refusal. Its reason used to say such a row "renders as before"; on the console that ships with 18 it does not.

Clause-②: no

A stored page row with an unregistered template or an unplaced region is still served unchanged, and saving it again is still refused until it is renamed. Until then the console draws a refusal in its place. An unregistered template draws no layout, only a refusal that names the template and the registered templates. On a `default`, `header-sidebar-main` or `three-column` page, an unplaced region is not drawn and is not moved into another slot. Where it used to be stacked, under `main`, a refusal names it and the slots that template places. A page that names no template takes its page type's layout, which still stacks such a region under `main`.

The entry's acceptance criteria are unchanged: rename the template or region, and each renamed region draws in its slot.
