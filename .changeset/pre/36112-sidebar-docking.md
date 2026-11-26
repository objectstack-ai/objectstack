---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(console): the sidebar's docking model — 1280 px starts expanded, the expand/collapse button is the one control, and Recent lists this app's items

Clause-②: no
Metadata-protocol: none

- **Which state a window starts in.** From 768 px up, a browser with no choice kept starts with the sidebar expanded on a window 1280 px wide and up, and collapsed from 768 to 1279 px. The threshold was 1416 px, and below it the sidebar folded on its own. `CONSOLE_SIDEBAR_RAIL_BELOW_WIDTH` is now 1280 (one constant).
- **The reader's choice wins, on each side.** The sidebar's collapse button and, while it is collapsed, the page header's expand button are the one control, and this browser keeps each press: a wide-window choice and a narrow-window choice, kept apart as before. The expand button now docks the sidebar beside the page; before, it floated the menu over the page. Resting the pointer on the window's left edge and ⌘B still float the menu over a collapsed sidebar without changing the choice. Phone widths are unchanged, and the sidebar stays 256 px wide.
- **"Keep sidebar open" is gone.** Its stored choice (the workspace preference `console.sidebar.keepOpen`) is now the narrow-window choice, so a reader who kept the sidebar open starts expanded on a narrow window. Nothing to migrate.
- **Upgrade change.** On a 1280 to 1415 px window, a reader who never kept the sidebar open now starts with it expanded (it folded before), unless they collapsed it on a wide window. The accepted cost: on a 1280 px window with the sidebar expanded, the list beside an open record drawer is 304 px wide (560 before), and on 1280 to 1415 px, opening the record page's comment panel moves its fields back to the tab row; collapsing the sidebar gives the width back.
- **Recent is this app's.** From 768 px up, the sidebar's Recent group lists only the items opened in the current app. Home's "Recently accessed" and the phone drawer still list every app's.

`@object-ui/i18n`: the `sidebar.keepOpen` key, which no surface reads any more, is dropped from all eleven packs (zh-Hant regenerated).
