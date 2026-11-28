---
'@object-ui/layout': patch
'@object-ui/app-shell': patch
'@object-ui/console': patch
'@objectstack/console': patch
---

perf(console): the sidebar no longer redraws every entry each time the console re-renders during first load

Clause-②: no
Metadata-protocol: none

While a console page first loads, the shell re-renders about ten times as its boot reads land. Each time, the sidebar redrew every navigation entry, and with each entry its ⋯ menu and tooltip: about 2,700 components per pass, several passes before the page could paint.

Now an entry is redrawn only when what it shows changes: its label, icon, colour, address, or the gates that decide whether it shows. The ⋯ menu redraws its menu tree only when its own text or entries change. The console's expression evaluator is no longer rebuilt on every render, because that rebuild alone made every entry redraw.

On a list page's first load this halves the components drawn before first paint. Nothing changes in what the sidebar shows or does.
