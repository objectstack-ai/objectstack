---
'@object-ui/plugin-list': patch
'@object-ui/plugin-grid': patch
'@object-ui/components': patch
'@object-ui/app-shell': patch
'@object-ui/mobile': patch
---

fix(ui): the list flow works at phone width — 44 px touch targets, panels inset from the screen edge, a pager on the card list, pull-to-refresh only at the top, and an active sort shown on the bar

Clause-②: no
Metadata-protocol: none

Measured in a real browser at 375 and 390 px on the CRM and showcase examples. Every change below applies below the `sm` breakpoint only, so wider screens are unchanged, with two exceptions said where they occur.

- **Touch targets.** The list bar's view switcher, Filter, Sort, Display and phone search (its field and Clear too) were 24 to 32 px. They are 44 px now. The same goes for the view switcher's menu (search, rows, star, pin, New view, Manage views), the Filter panel (field, operator, value, Remove, Add filter, Clear all, And/Or), the Sort builder, the Group editor and the Display panel's rows, switches and footer buttons. On a touch screen a view row's star and pin always show, because there is no hover to reveal them. This holds at every width on a touch screen, and a mouse still reveals them on hover.
- **Panels.** The Filter, Sort and Display panels keep 16 px from both screen edges. They used to run flush against one edge.
- **Whole labels.** A sort level and a filter condition give the field select its row's whole width, so a label such as "Last Modified At" is no longer cut to "Creat…" or "Accou…". The filter value field uses 16 px text, so iOS Safari does not zoom in when it is focused.
- **Long lists.** Under server pagination, the phone's card list showed only the first page (50 of 403 records), with no way to reach the rest except search or filter. It now ends in a pager (First, Previous, page N of M, Next, Last) that turns the same page the table's pager does. It uses the table's existing words.
- **Pull-to-refresh.** The list bound the gesture to its root, which never scrolls, so a downward drag halfway down the list (a reader scrolling back up) showed "Pull to refresh" and refetched. `usePullToRefresh` now starts a pull only when every scroll box between the touched node and the bound element is at its top. This applies at every width, wherever the hook is used.
- **Back from a record a list opened.** On a phone a list row pushes the record's page and now marks the push as a related row does, so the page's 「‹」 goes back in the history to the list. Back after it then leaves the list instead of opening the record again. The 「‹」 still reads the object's plural. A phone answering a drawer link replaces the list and stays unmarked; desktop is unchanged.
- **Active sort.** Below `sm` the Sort builder lives in the Display panel, so the bar used to show nothing once a list was sorted. While a sort is active, the bar now keeps the Sort trigger with its level count, which opens the builder. It steps aside while the phone search field is open.

Nothing a view declares changes, and no public prop, package export or translation key is added.
