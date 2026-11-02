---
'@object-ui/layout': patch
---

perf(layout): the phone nav drawer opens in one render, and its opening frame draws only the rows that fit

Clause-②: no
Metadata-protocol: none

Opening the Console's nav drawer on a phone took 300 to 580 ms at 4x CPU on an app with a long menu (the showcase, 50 entries in 8 groups). A profile of the open named three costs in `NavigationRenderer`, and each is gone:

- **One render per row.** Every row asked `useIsMobile()` for itself. That hook answers "not a phone" on its first render and corrects itself in an effect, so each time the drawer opened (the sheet mounts the menu afresh) the whole menu rendered at desktop size, then every row set state and the menu rendered and restyled a second time. The rows now read one answer from the menu's root: the sidebar provider's own phone flag, which settled when the shell mounted. A menu drawn with no sidebar provider asks the viewport once for all its rows, as before.
- **No hidden tooltips.** A row's tooltip names it in the collapsed icon rail. On a phone the sidebar primitive draws that tooltip hidden, so a phone row now skips it. Desktop rows keep their tooltip.
- **The opening frame draws what fits.** On a phone, a menu longer than the window draws the rows that fit (and a few more) in the frame the drawer opens with, and the rest join right after it, while the drawer is still sliding in. The rows drawn first are not drawn again. The full menu, its order, labels, icons, badges, pins and active entry are unchanged. Desktop draws the whole menu at once, as before.

Measured on the production Console at 4x CPU, 390 px wide, from the tap to the first painted frame, 20 opens each on one backend: the showcase drawer went from 203 to 640 ms (0 of 20 opens under 200 ms, median 305) to 60 to 368 ms (17 of 20 under 200 ms, median 116). The CRM drawer went from 14 to 19 of 20 opens under 200 ms. The group toggle was and stays under 90 ms in the page. No request is added to the open, and no metadata key or option changes.
