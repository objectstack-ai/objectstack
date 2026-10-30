---
'@object-ui/app-shell': patch
---

fix(setup): metadata lists under Setup take their title from the sidebar, lead with the label, and keep rows short

Clause-②: no
Metadata-protocol: none

A metadata list under Setup (Positions, Permission Sets and the other catalog pages) titled itself with the type's singular label ("Position"), led each row with the API name, and let a long description wrap a row to several lines on a phone. Under Setup the page now takes its title from the app's own navigation entry that opens it, so it reads as the sidebar row that opened it ("Positions", in the served language), and falls back to the type's label when no entry opens exactly that page. Each row leads with the item's label, with its API name beneath it in small monospace type, in place of a separate Label column; an item with no label keeps its API name as the link. A description shows two lines at most, with the whole text on hover. The same page outside Setup is unchanged.
