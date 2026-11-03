---
'@object-ui/app-shell': patch
---

fix(app-shell): on a phone the navigation drawer closes when an entry opens its page, and the top bar's controls and menus are 44 px touch targets

Clause-②: no
Metadata-protocol: none

The Console at phone width (375 and 390 px), as a WebView host shows it:

- **The drawer closes on navigation.** Below 768 px the sidebar is a drawer over the page. Tapping one of its entries used to open the page under a drawer that stayed open, so every navigation cost a second tap. A route change now closes the drawer, whichever entry (navigation, favorite, recent) or other control changed the route. Wider windows are unchanged.
- **44 px controls below `md`.** The top bar's sidebar trigger, product mark, app pill, search, Studio button, inbox bell, AI button and account avatar measured 28 to 34 px; they are 44 px below 768 px. So are the theme and language buttons in the account menu and the page header's Refresh button. The rows of the app switcher, account, theme and language menus are 44 px tall there too (they were 32 and 38 px).
- **A roomier phone bar.** Below 640 px an app's bar no longer draws the product mark (and its `/` rule) or the Studio button, which made room for the 44 px controls and the page title. Both stay one tap away: the app switcher's menu has "Back to home" and the Studio row, and the drawer's "All apps" goes home. Home and the other platform surfaces keep the product mark.
