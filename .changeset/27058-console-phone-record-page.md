---
'@object-ui/app-shell': patch
'@object-ui/components': patch
---

feat(console,components): on a phone the record is always a page, with a compact header, a bottom action bar, and related records pushed as pages with a path row

Clause-②: yes (widening: `@object-ui/components` gains the export `PageHeaderPhoneContext`, its type `PageHeaderPhoneFace`, and the optional prop `PageHeaderActionsProps.face` (`'row'`, the default, or `'bar'`); no export is removed, and `MobileViewSwitcherContext` was never on a package entry)
Metadata-protocol: none

Below 768 px (the `useIsMobile` breakpoint) the console is on a phone. Nothing here reads metadata the console did not read before, and no reader preference is added.

- **The record is a page.** The object list passes `viewport: 'mobile'` to `deriveRecordSurface`, so a row tap navigates to the record route, handed the list as its way back and its rows as its ↓ ↑ set. The split pane and the drawer are never mounted; a `?recordId=` link is replaced by the record page; the Display menu has no Open records section, and a stored split or drawer preference draws nothing. A record created from the list opens as a page too.
- **One view switcher.** The list's title switcher 「view ▾ · N」 leads the list's toolbar row below `sm` (or heads a chart), beside the filter and display controls, and the Display menu drops its Layout row there. The app bar no longer draws a second view dropdown: the `MobileViewSwitcherContext` channel is retired.
- **The top bar** is one way back, 「‹ object plural」, to the list the page came from (or the object's list), with the counter and ↓ ↑ when the page knows its rows. No ⊟ and no ⤡: the stack has no right column and there is no drawer to collapse to.
- **The header** of a default page takes its subtitle from the first two declared text `highlightFields` (「Atlas Construction · Director of Sales」) and shows at most four highlights after them. An object that declares no highlights draws no subtitle; an authored page draws its own header.
- **The bottom action bar.** The header draws no action row: its actions, resolved by the same `PageHeaderActions`, are drawn into a bar at the foot of the page above the safe area, in their bar face: the primary action, one more and the `⋯`. The host's Edit queues after the page's own actions, so it takes the second slot when the page declares one action and folds into the `⋯` when a declared second action fills the bar. A page's `mobileMaxVisible` still sets the budget. The bar is the page column's last row, so it stays in view while the body scrolls above it.
- **One level down.** A related row or a lookup pushes its record as a page (the `?from=` trail extended, no drawer stack), with a path row 「Lead Mira Costa › Task」 under the top bar; 「‹」 and the path row's parent go back in the history to the parent, which comes back where it was scrolled. The pushed page's ↓ ↑ step through the parent's related rows.
- **Unchanged.** Every width from 768 px up, the record pane and drawer mechanics, and the record page's layout rule (the stack below 760 px and the tab row read the page's own width, as before).
