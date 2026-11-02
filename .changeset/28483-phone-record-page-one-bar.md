---
'@object-ui/app-shell': patch
'@object-ui/layout': patch
---

feat(app-shell): a phone record page draws one bar, its own top bar, and the record's name once

Clause-②: yes (widening)
Metadata-protocol: none

Below 768 px a console record page drew two bars at its top: the app bar (sidebar trigger, app, the record's name, search, notifications, account) and, under it, the record page's own top bar (「‹ <object plural>」 and the counter with ↓ ↑). The record's name showed twice, once in the app bar and once as the header title right below it.

- **One bar on a phone record page.** Below 768 px the console mounts no app bar on a record route (`/apps/APP/OBJECT/record/ID`, and the same record on a named record page, `.../page/PAGE`). The record page's top bar is the page's one bar, and the record's name shows once, as the header title.
- **The four doors stay on the root routes.** The app menu, search, notifications and the account menu stay in the app bar on every other route: the object's list, home, dashboards, the record's edit form. A phone record page reaches them through its 「‹」 link, one tap. No menu is added to the record bar, and there is no bottom navigation bar.
- **A record page that cannot show its record keeps its 「‹」 bar on a phone.** While it loads, and when the record is not found, the read is refused or fails, the object is unknown, the named page is not one of the object's record pages, or the viewer's approval access has ended, the page draws the same back bar above that state, so a deep link always has a way off the page.
- **768 px and up is unchanged.** Every route keeps the app bar, and a record page that cannot show its record draws no extra bar.
- **`AppShell` gains `showHeader`** (`@object-ui/layout`, optional, default `true`). `showHeader={false}` draws no `<header>` element and does not mount `navbar`. Leaving it out renders exactly as before, including a shell with no `navbar`, which still draws its empty bar.
