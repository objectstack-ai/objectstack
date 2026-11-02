---
'@object-ui/app-shell': patch
---

fix(app-shell): on a phone, Back with the navigation drawer open closes the drawer and stays on the page

Clause-②: no
Metadata-protocol: none

Below 768 px the Console's sidebar is a drawer over the page. Back with the drawer open (the browser's Back, or Android's back gesture in a WebView host) used to leave the page the drawer was opened on. The open drawer now owns one history entry:

- **Back closes the drawer.** The URL stays the page it was on; the next Back leaves the page as before.
- **No stray entries.** Closing the drawer any other way (an outside tap, Escape, the sidebar trigger) removes its entry, so Back never stops on a page that does not change. Choosing an entry in the drawer replaces it, so Back from the new page returns to the page the drawer was opened on.
- **A reload does not reopen it.** A reload with the drawer open comes back with the drawer closed and no drawer entry left; Forward to a drawer entry reopens the drawer.
- Wider windows are unchanged: opening and closing the sidebar there writes no history.
