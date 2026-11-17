---
'@object-ui/components': patch
'@object-ui/plugin-detail': patch
---

fix(ui): on a phone the record page keeps Edit in its bottom bar, names the current stage in full, and lays its key fields out in two columns

Clause-②: no
Metadata-protocol: none

Three phone-width changes to the record page. Desktop layouts are unchanged.

- **Bottom action bar.** On an editable record the bar is now Edit, the primary action, then the `⋯` menu with every other action. Before, the page's own actions took both slots first, so an object with two record actions pushed Edit into the `⋯`. The primary is the action declaring `variant: 'primary'`, else the first action. A record the reader cannot edit keeps the primary and one more. A destructive host action (Delete) still always goes in the `⋯`. `page:header`'s `mobileMaxVisible` still sets how many buttons the bar holds; a budget of one is Edit's.
- **Stage bar (`record:path`).** Below the `sm` breakpoint the path draws one progress segment per stage and no stage names, then one line with the step and the current stage's full name ("Step 5 of 6 · Negotiation", the existing form `stepOf` copy). The step counts the forward stages; a record on a lost stage shows that stage, marked lost, with no step. Tapping the line lists every stage by its full name, and on a path that allows stage changes each reachable stage there moves the record, behind the same permission and state-machine checks as on desktop. Nothing is authored for this: the viewport picks the mode.
- **Key-field strip on a hand-written page.** Below `sm` the strip is a two-column grid, as the default page's is, so six key fields read as three rows instead of six lines. A value too long for its cell ends in an ellipsis.
